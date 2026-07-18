/**
 * Push notification routes — split into public and protected.
 *
 * pushPublicRouter  (no auth required):
 *   GET /push/vapid-public-key — VAPID public key is not a secret; safe to expose publicly.
 *
 * pushProtectedRouter  (requireAuth required — mounted AFTER requireAuth in index.ts):
 *   POST /push/subscribe — registers a Web Push subscription for the AUTHENTICATED user.
 *     userId is always taken from req.auth (set by requireAuth), never from the request body.
 *     One row per userId: upsert replaces stale endpoint on re-subscribe.
 */

import { Router, type IRouter } from "express";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";

// ── Public router ─────────────────────────────────────────────────────────────
const pushPublicRouter: IRouter = Router();

pushPublicRouter.get("/push/vapid-public-key", (_req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY ?? "";
  res.json({ publicKey: key });
});

// ── Protected router (mounted after requireAuth) ───────────────────────────────
const pushProtectedRouter: IRouter = Router();

pushProtectedRouter.post("/push/subscribe", async (req, res): Promise<void> => {
  // Always derive userId from the verified auth token — never trust the request body.
  const userId = req.auth!.userId;
  const { subscription } = req.body as { subscription?: unknown };

  if (!subscription || typeof subscription !== "object") {
    res.status(400).json({ error: "subscription is required" });
    return;
  }

  // Upsert: if a row already exists for this userId update it, else insert.
  await db
    .insert(pushSubscriptionsTable)
    .values({
      userId,
      subscription,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.userId,
      set: {
        subscription,
        updatedAt: sql`now()`,
      },
    });

  req.log.info({ userId }, "Push subscription saved");
  res.status(201).json({ ok: true });
});

export { pushPublicRouter, pushProtectedRouter };
