/**
 * blockFrozenAccounts middleware
 *
 * Runs after requireAuth on all protected routes.  Checks the caller's
 * account_status and rejects with 403 if the account is suspended or banned.
 *
 * To avoid a DB round-trip on every request the status is cached briefly
 * (CACHE_TTL_MS = 10 s) in a simple in-memory Map.  The cache entry for a
 * user is immediately invalidated by calling invalidateAccountStatusCache()
 * after any admin suspend/ban/unsuspend/unban action, so a frozen user is
 * cut off instantly rather than waiting out the TTL.
 *
 * Allowlisted paths (frozen users may still reach these):
 *   GET  /account/:userId/status   — status polling for the frontend gate
 *   GET  /appeal                   — fetch existing appeal
 *   POST /appeal                   — submit a new appeal
 *   GET  /support/thread           — read support thread
 *   POST /support/thread/send      — send a support message
 */

import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// TTL status cache — mirrors the session-store.ts pattern
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 10_000; // 10 seconds

interface CacheEntry {
  status: string;
  expiresAt: number;
}

const statusCache = new Map<string, CacheEntry>();

// Sweep expired entries every 60 seconds to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of statusCache) {
    if (v.expiresAt < now) statusCache.delete(k);
  }
}, 60_000).unref();

/**
 * Immediately evict a user's cached status.
 * Call this after any admin suspend/ban/unsuspend/unban action so the next
 * request by that user performs a fresh DB lookup instead of serving the
 * stale "approved" entry.
 */
export function invalidateAccountStatusCache(userId: string): void {
  statusCache.delete(userId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAccountStatus(userId: string): Promise<string | null> {
  const cached = statusCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.status;

  const [user] = await db
    .select({ accountStatus: usersTable.accountStatus })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) return null;

  statusCache.set(userId, { status: user.accountStatus, expiresAt: Date.now() + CACHE_TTL_MS });
  return user.accountStatus;
}

/**
 * Routes that a suspended/banned user must still be able to reach so they
 * can check their status, submit an appeal, or contact support.
 */
function isFreezeAllowlisted(req: Request): boolean {
  const p = req.path;

  // GET /account/:userId/status — frontend gate's polling endpoint
  if (req.method === "GET" && /^\/account\/[^/]+\/status$/.test(p)) return true;

  // GET /appeal + POST /appeal — appeal fetch & submission
  if (p === "/appeal") return true;

  // GET /support/thread + POST /support/thread/send — support chat
  if (p === "/support/thread" || p === "/support/thread/send") return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

export async function blockFrozenAccounts(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.auth?.userId;

  // No auth (shouldn't happen after requireAuth) or allowlisted path → pass through
  if (!userId || isFreezeAllowlisted(req)) {
    next();
    return;
  }

  try {
    const status = await fetchAccountStatus(userId);

    if (status === "suspended") {
      res.status(403).json({
        error: "حسابك موقوف مؤقتاً. تواصل مع الدعم الفني لمعرفة التفاصيل.",
        code:  "ACCOUNT_SUSPENDED",
      });
      return;
    }

    if (status === "banned") {
      res.status(403).json({
        error: "حسابك محظور. يمكنك تقديم طعن للمراجعة من داخل التطبيق.",
        code:  "ACCOUNT_BANNED",
      });
      return;
    }

    next();
  } catch (err) {
    // Fail open on DB error — a flaky DB shouldn't lock out legitimate users.
    logger.error({ err, userId }, "blockFrozenAccounts: status lookup failed — failing open");
    next();
  }
}
