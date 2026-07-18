/**
 * Generic appeals routes — replaces the old /driver/appeal endpoints.
 *
 * Both drivers ("rejected") and consumers ("banned") use these routes.
 * The underlying table is still named driver_appeals / driver_id for
 * backward-compatibility; see lib/db schema comment for details.
 *
 * GET  /appeal  — fetch the caller's most recent appeal
 * POST /appeal  — submit a new appeal (one active appeal per user)
 *
 * Both routes are allowlisted in blockFrozenAccounts so that suspended/banned
 * users can always reach them.
 */

import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, driverAppealsTable, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Account statuses from which a user is allowed to submit an appeal. */
const APPEALABLE_STATUSES = new Set(["rejected", "banned"]);

// ─────────────────────────────────────────────────────────────────────────────
// GET /appeal — fetch the caller's most recent appeal
// ─────────────────────────────────────────────────────────────────────────────
router.get("/appeal", async (req, res): Promise<void> => {
  const userId = req.auth?.userId;
  if (!userId) { res.status(401).json({ error: "غير مصرح" }); return; }

  const [appeal] = await db
    .select({
      id:            driverAppealsTable.id,
      status:        driverAppealsTable.status,
      message:       driverAppealsTable.message,
      adminResponse: driverAppealsTable.adminResponse,
      createdAt:     driverAppealsTable.createdAt,
      reviewedAt:    driverAppealsTable.reviewedAt,
      reason:        driverAppealsTable.reason,
    })
    .from(driverAppealsTable)
    .where(eq(driverAppealsTable.driverId, userId)) // driverId stores any user's id
    .orderBy(desc(driverAppealsTable.createdAt))
    .limit(1);

  res.json(appeal ?? null);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /appeal — submit an appeal
// ─────────────────────────────────────────────────────────────────────────────
router.post("/appeal", async (req, res): Promise<void> => {
  const userId = req.auth?.userId;
  if (!userId) { res.status(401).json({ error: "غير مصرح" }); return; }

  const { message } = req.body as { message?: string };
  if (!message?.trim()) {
    res.status(400).json({ error: "نص الطعن مطلوب" });
    return;
  }

  // Fetch the caller's current account status to (a) validate they're allowed
  // to appeal and (b) record the reason on the appeal row.
  const [user] = await db
    .select({ accountStatus: usersTable.accountStatus })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  if (!APPEALABLE_STATUSES.has(user.accountStatus)) {
    res.status(400).json({
      error: "لا يمكن تقديم طعن في الوضع الحالي لحسابك",
    });
    return;
  }

  // Prevent spam: one active (pending) appeal at a time
  const [existing] = await db
    .select({ id: driverAppealsTable.id, status: driverAppealsTable.status })
    .from(driverAppealsTable)
    .where(eq(driverAppealsTable.driverId, userId))
    .orderBy(desc(driverAppealsTable.createdAt))
    .limit(1);

  if (existing?.status === "pending") {
    res.status(409).json({ error: "لديك طعن قيد المراجعة بالفعل" });
    return;
  }

  const [inserted] = await db
    .insert(driverAppealsTable)
    .values({
      driverId: userId,
      message:  message.trim(),
      status:   "pending",
      reason:   user.accountStatus, // "rejected" | "banned"
    })
    .returning();

  logger.info({ userId, appealId: inserted.id, reason: user.accountStatus }, "User appeal submitted");
  res.status(201).json({ id: inserted.id, status: "pending" });
});

export default router;
