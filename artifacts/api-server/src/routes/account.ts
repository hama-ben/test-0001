/**
 * Generic account-status endpoint.
 *
 * GET /account/:userId/status
 *   Protected by requireAuth (caller must be authenticated).
 *   A user may only fetch their own status (req.auth.userId === params.userId).
 *   Returns { accountStatus, userType } — the same shape used by the frontend
 *   AccountStatusGate to decide which blocking overlay to show.
 *
 *   This endpoint is also allowlisted in blockFrozenAccounts so that frozen
 *   users can still poll their own status (which is exactly when they need it).
 */

import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/account/:userId/status", async (req, res): Promise<void> => {
  const callerId = req.auth?.userId;
  if (!callerId) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }

  if (callerId !== req.params.userId) {
    res.status(403).json({ error: "لا يمكنك الاطلاع على حالة حساب مستخدم آخر" });
    return;
  }

  const [user] = await db
    .select({ accountStatus: usersTable.accountStatus, userType: usersTable.userType })
    .from(usersTable)
    .where(eq(usersTable.id, callerId));

  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  res.json({ accountStatus: user.accountStatus, userType: user.userType });
});

export default router;
