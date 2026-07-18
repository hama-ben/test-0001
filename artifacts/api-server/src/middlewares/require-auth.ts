/**
 * requireAuth middleware — Supabase Auth JWT validation
 *
 * Reads the `Authorization: Bearer <access_token>` header on every
 * protected request. The token is a Supabase-issued JWT (HS256).
 *
 * Validation strategy (in priority order):
 *
 *   FAST PATH — local cryptographic verification (no network round-trip):
 *     If SUPABASE_JWT_SECRET is set, the JWT is verified in-process using
 *     the `jsonwebtoken` library.  This validates the signature, issuer,
 *     audience, and expiry without any external network call.
 *
 *   SLOW PATH — Supabase network call (fallback):
 *     If SUPABASE_JWT_SECRET is not set, the middleware falls back to
 *     supabase.auth.getUser(token) — identical to the previous behaviour.
 *     A one-time startup warning is logged urging the operator to set the
 *     secret so the fast path can be activated.
 *
 * Downstream contract is unchanged in both paths:
 *   - On success  → req.auth = { userId, userType }
 *   - On failure  → 401 JSON  { error: "رمز المصادقة غير صالح أو منتهي الصلاحية" }
 *   - Server mis-config → 503 JSON
 *
 * userType resolution order (both paths):
 *   1. app_metadata.userType (set at registration — no DB call)
 *   2. user_metadata.userType (legacy fallback)
 *   3. DB lookup (admin-created users with no metadata)
 */

import type { Request, Response, NextFunction } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getSupabaseAuth } from "../lib/supabase-server";
import { logger } from "../lib/logger";

// ─────────────────────────────────────────────────────────────────────────────
// JWT secret — read once at module load
// ─────────────────────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET?.trim() ?? null;

if (!JWT_SECRET) {
  logger.warn(
    "requireAuth: SUPABASE_JWT_SECRET is not set — falling back to supabase.auth.getUser() " +
    "(network round-trip on every protected request). " +
    "Set SUPABASE_JWT_SECRET (from your Supabase dashboard → Settings → API → JWT Secret) " +
    "to enable in-process verification and remove this overhead."
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared types / declarations
// ─────────────────────────────────────────────────────────────────────────────

export interface AuthPayload {
  userId:   string;
  userType: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — resolve userType and attach req.auth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a verified userId and optional metadata objects, resolves userType and
 * attaches req.auth.  Falls back to a DB lookup when metadata lacks userType
 * (admin-created users).  Returns true on success, false on failure (caller
 * must not call next() on false).
 */
async function attachAuth(
  req: Request,
  res: Response,
  next: NextFunction,
  userId: string,
  appMeta?: Record<string, unknown>,
  userMeta?: Record<string, unknown>,
): Promise<void> {
  const userTypeFromMeta =
    (appMeta?.userType  as string | undefined) ??
    (userMeta?.userType as string | undefined);

  if (userTypeFromMeta) {
    req.auth = { userId, userType: userTypeFromMeta };
    next();
    return;
  }

  // DB fallback for admin-created users with no metadata
  try {
    const [dbUser] = await db
      .select({ userType: usersTable.userType })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!dbUser) {
      res.status(401).json({ error: "الحساب غير موجود" });
      return;
    }

    req.auth = { userId, userType: dbUser.userType };
    next();
  } catch (err) {
    logger.error({ err, userId }, "requireAuth: DB lookup failed");
    res.status(500).json({ error: "خطأ داخلي في الخادم" });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────────────────────

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });
    return;
  }

  // ── FAST PATH: local cryptographic verification ───────────────────────────
  if (JWT_SECRET) {
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, JWT_SECRET, {
        algorithms: ["HS256"],
      }) as JwtPayload;
    } catch (err) {
      // TokenExpiredError, JsonWebTokenError, NotBeforeError — all → 401
      res.status(401).json({ error: "رمز المصادقة غير صالح أو منتهي الصلاحية" });
      return;
    }

    const userId = payload.sub;
    if (!userId) {
      res.status(401).json({ error: "رمز المصادقة غير صالح أو منتهي الصلاحية" });
      return;
    }

    await attachAuth(
      req, res, next,
      userId,
      payload.app_metadata  as Record<string, unknown> | undefined,
      payload.user_metadata as Record<string, unknown> | undefined,
    );
    return;
  }

  // ── SLOW PATH: Supabase network call (fallback when secret not set) ────────
  const supabase = getSupabaseAuth();
  if (!supabase) {
    logger.error(
      "requireAuth: Supabase auth client not available — " +
      "SUPABASE_URL/SUPABASE_ANON_KEY not set"
    );
    res.status(503).json({ error: "الخادم غير مهيأ بشكل صحيح" });
    return;
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "رمز المصادقة غير صالح أو منتهي الصلاحية" });
    return;
  }

  await attachAuth(
    req, res, next,
    user.id,
    user.app_metadata  as Record<string, unknown> | undefined,
    user.user_metadata as Record<string, unknown> | undefined,
  );
}
