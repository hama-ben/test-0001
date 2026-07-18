/**
 * Admin API — secured with X-Admin-Key header matching ADMIN_API_KEY env var.
 *
 * These endpoints are called by the admin panel (separate project) to:
 *  - List and approve/reject driver applications
 *  - List and approve/reject subscription payment receipts
 *
 * On approval/rejection, a targeted announcement is inserted into the
 * Supabase announcements table using target_audience = driverId
 * (the convention for single-user targeting when target_user_id column
 * is not yet available).
 */

import { Router, type Request, type Response, type NextFunction, type IRouter } from "express";
import { eq, desc, sql, asc, and, ne } from "drizzle-orm";
import { signDriverDocUrl } from "../lib/storage-init";
import {
  db,
  usersTable,
  driverDetailsTable,
  subscriptionPaymentsTable,
  supportMessagesTable,
} from "@workspace/db";
import { getSupabaseAdmin } from "../lib/supabase-server";
import { emitToUser } from "../lib/socket-server";
import { sendPushToUser } from "../lib/web-push";
import { invalidateAccountStatusCache } from "../middlewares/block-frozen-accounts";

const router: IRouter = Router();

// ── Admin auth middleware ─────────────────────────────────────────────────────

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminKey = process.env.ADMIN_API_KEY?.trim();
  if (!adminKey) {
    res.status(503).json({ error: "Admin API not configured (ADMIN_API_KEY missing)" });
    return;
  }
  const provided = req.headers["x-admin-key"];
  if (provided !== adminKey) {
    res.status(403).json({ error: "Unauthorized" });
    return;
  }
  next();
}

router.use("/admin", requireAdmin);

// ── Helper: insert targeted announcement to Supabase ─────────────────────────

async function insertTargetedAnnouncement(
  targetUserId: string,
  title: string,
  content: string
): Promise<void> {
  const supa = getSupabaseAdmin();
  if (!supa) return;
  await supa.from("announcements").insert({
    title,
    content,
    // Convention: target_audience = userId means "only this user sees it"
    target_audience: targetUserId,
    is_active: true,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// DRIVER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

// GET /admin/drivers?status=pending|approved|rejected|all
router.get("/admin/drivers", async (req, res): Promise<void> => {
  const status = req.query.status as string | undefined;

  const rows = await db
    .select({
      id:                   usersTable.id,
      name:                 usersTable.name,
      phone:                usersTable.phone,
      email:                usersTable.email,
      wilaya:               usersTable.wilaya,
      commune:              usersTable.commune,
      accountStatus:        usersTable.accountStatus,
      subscriptionExpiresAt: usersTable.subscriptionExpiresAt,
      truckFrontPhotoUrl:   driverDetailsTable.truckFrontPhotoUrl,
      driverLicenseUrl:     driverDetailsTable.driverLicenseUrl,
      truckSidePhotoUrl:    driverDetailsTable.truckSidePhotoUrl,
      truckVideoUrl:        driverDetailsTable.truckVideoUrl,
      isLegacyDriver:       driverDetailsTable.isLegacyDriver,
    })
    .from(usersTable)
    .leftJoin(driverDetailsTable, eq(usersTable.id, driverDetailsTable.driverId))
    .where(
      status && status !== "all"
        ? sql`${usersTable.userType} = 'سائق' AND ${usersTable.accountStatus} = ${status}`
        : sql`${usersTable.userType} = 'سائق'`
    )
    .orderBy(desc(usersTable.id));

  const signedRows = await Promise.all(
    rows.map(async (r) => ({
      ...r,
      subscriptionExpiresAt: r.subscriptionExpiresAt?.toISOString() ?? null,
      truckFrontPhotoUrl: await signDriverDocUrl(r.truckFrontPhotoUrl),
      driverLicenseUrl:   await signDriverDocUrl(r.driverLicenseUrl),
      truckSidePhotoUrl:  await signDriverDocUrl(r.truckSidePhotoUrl),
      truckVideoUrl:      await signDriverDocUrl(r.truckVideoUrl),
    }))
  );

  res.json(signedRows);
});

// POST /admin/drivers/:driverId/approve
router.post("/admin/drivers/:driverId/approve", async (req, res): Promise<void> => {
  const { driverId } = req.params;

  const [user] = await db
    .select({
      id:                    usersTable.id,
      accountStatus:         usersTable.accountStatus,
      firstApprovalGranted:  usersTable.firstApprovalGranted,
      subscriptionExpiresAt: usersTable.subscriptionExpiresAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, driverId));

  if (!user) {
    res.status(404).json({ error: "السائق غير موجود" });
    return;
  }

  const isFirstApproval = !user.firstApprovalGranted;
  const now = new Date();
  // Document-approval gift is exactly 30 days, as specified — not 32.
  const giftDays = 30;

  if (isFirstApproval) {
    req.log.info(
      {
        endpoint: "POST /admin/drivers/:driverId/approve",
        driverId,
        before:   user.subscriptionExpiresAt?.toISOString() ?? null,
        giftDays,
        utcNow:   now.toISOString(),
      },
      "[SUBSCRIPTION WRITE PRE] first-approval doc gift"
    );
  }

  // WHERE clause includes first_approval_granted = false for first-approval branch:
  // this closes the TOCTOU window — a concurrent approval that already committed will
  // have flipped the flag to true, causing 0 rows to match and preventing a double-gift.
  const [updated] = await db
    .update(usersTable)
    .set({
      accountStatus: "approved",
      ...(isFirstApproval
        ? {
            // Additive/safe even though this should only ever fire once per
            // driver (guarded by the WHERE clause below) — never a bare overwrite.
            subscriptionExpiresAt: sql`GREATEST(COALESCE(${usersTable.subscriptionExpiresAt}, NOW()), NOW()) + (${giftDays} * INTERVAL '1 day')`,
            firstApprovalGranted: true,
          }
        : {}
      ),
    })
    .where(
      isFirstApproval
        ? and(eq(usersTable.id, driverId), eq(usersTable.firstApprovalGranted, false))
        : eq(usersTable.id, driverId)
    )
    .returning({ subscriptionExpiresAt: usersTable.subscriptionExpiresAt });

  if (isFirstApproval) {
    if (!updated) {
      // Concurrent approval already committed — idempotent, respond with current state.
      req.log.warn({ driverId }, "First-approval concurrent race detected — no-op");
      res.json({ ok: true, driverId, accountStatus: "approved", giftGranted: false, raceSkipped: true });
      return;
    }

    req.log.info(
      {
        endpoint: "POST /admin/drivers/:driverId/approve",
        driverId,
        before:   user.subscriptionExpiresAt?.toISOString() ?? null,
        after:    updated.subscriptionExpiresAt?.toISOString() ?? null,
        giftDays,
        utcNow:   new Date().toISOString(),
      },
      "[SUBSCRIPTION WRITE POST] first-approval doc gift"
    );

    await insertTargetedAnnouncement(
      driverId,
      "🎉 تم قبولك بيننا",
      `تهانينا! حصلت على هدية ${giftDays} يوماً مجاناً كمستخدم جديد. مرحباً بك في عائلة ميزو!`
    );
    req.log.info({ driverId, subscriptionExpiresAt: updated.subscriptionExpiresAt, giftDays }, "Driver approved (first time) — 30-day gift granted");
  } else {
    await insertTargetedAnnouncement(
      driverId,
      "تم قبولك بيننا",
      "مرحباً بك مجدداً"
    );
    req.log.info({ driverId }, "Driver re-approved — no additional gift");
  }

  res.json({
    ok: true,
    driverId,
    accountStatus: "approved",
    giftGranted: isFirstApproval,
    ...(isFirstApproval ? { subscriptionExpiresAt: updated?.subscriptionExpiresAt?.toISOString() ?? null } : {}),
  });
});

// POST /admin/drivers/:driverId/reject
router.post("/admin/drivers/:driverId/reject", async (req, res): Promise<void> => {
  const { driverId } = req.params;
  const { reason } = req.body as { reason?: string };

  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.id, driverId));

  if (!user) {
    res.status(404).json({ error: "السائق غير موجود" });
    return;
  }

  await db
    .update(usersTable)
    .set({ accountStatus: "rejected" })
    .where(eq(usersTable.id, driverId));

  // Targeted rejection notification
  await insertTargetedAnnouncement(
    driverId,
    "تم رفض طلبك",
    reason ?? "الرجاء التواصل مع الإدارة عبر الصفحات الرسمية."
  );

  req.log.info({ driverId }, "Driver rejected");
  res.json({ ok: true, driverId, accountStatus: "rejected" });
});

// ═══════════════════════════════════════════════════════════════════════
// SUBSCRIPTION PAYMENT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

// GET /admin/payments?status=pending|approved|rejected|all
router.get("/admin/payments", async (req, res): Promise<void> => {
  const status = req.query.status as string | undefined;

  const rows = await db
    .select({
      id:           subscriptionPaymentsTable.id,
      driverId:     subscriptionPaymentsTable.driverId,
      receiptImage: subscriptionPaymentsTable.receiptImage,
      months:       subscriptionPaymentsTable.months,
      status:       subscriptionPaymentsTable.status,
      adminNotes:   subscriptionPaymentsTable.adminNotes,
      createdAt:    subscriptionPaymentsTable.createdAt,
      reviewedAt:   subscriptionPaymentsTable.reviewedAt,
      driverName:   usersTable.name,
      driverPhone:  usersTable.phone,
      driverWilaya: usersTable.wilaya,
      subscriptionExpiresAt: usersTable.subscriptionExpiresAt,
    })
    .from(subscriptionPaymentsTable)
    .leftJoin(usersTable, eq(subscriptionPaymentsTable.driverId, usersTable.id))
    .where(
      status && status !== "all"
        ? sql`${subscriptionPaymentsTable.status} = ${status}`
        : sql`1 = 1`
    )
    .orderBy(desc(subscriptionPaymentsTable.createdAt));

  res.json(rows.map(r => ({
    ...r,
    createdAt:            r.createdAt?.toISOString()  ?? null,
    reviewedAt:           r.reviewedAt?.toISOString() ?? null,
    subscriptionExpiresAt: r.subscriptionExpiresAt?.toISOString() ?? null,
  })));
});

// POST /admin/payments/:paymentId/approve
router.post("/admin/payments/:paymentId/approve", async (req, res): Promise<void> => {
  const { paymentId } = req.params;

  const [payment] = await db
    .select({
      id:       subscriptionPaymentsTable.id,
      driverId: subscriptionPaymentsTable.driverId,
      status:   subscriptionPaymentsTable.status,
      months:   subscriptionPaymentsTable.months,
    })
    .from(subscriptionPaymentsTable)
    .where(eq(subscriptionPaymentsTable.id, paymentId));

  if (!payment) {
    res.status(404).json({ error: "الدفع غير موجود" });
    return;
  }

  // Idempotency guard: only pending payments can be approved.
  // Approving an already-approved payment would double-stack subscription days.
  if (payment.status !== "pending") {
    res.status(409).json({
      error: "لا يمكن الموافقة على هذا الدفع",
      detail: `الحالة الحالية: ${payment.status}. يُسمح فقط بالموافقة على الدفعات المعلقة.`,
    });
    return;
  }

  // Dynamic duration: months stored on the payment record (default 1 → 30 days),
  // plus a fixed +3-day gift bonus granted on every approved receipt.
  // This is the ONLY place subscription days are granted for a receipt —
  // nothing is granted at upload time — and it always stacks on top of
  // whatever the driver already has (see the GREATEST(...) SQL update below).
  const RECEIPT_GIFT_DAYS = 3;
  const months    = payment.months ?? 1;
  const daysToAdd = months * 30 + RECEIPT_GIFT_DAYS;

  req.log.info(
    { paymentId, driverId: payment.driverId, monthsFromDB: payment.months, months, daysToAdd },
    "Payment approval — duration resolved"
  );

  const now = new Date();

  // Single transaction wrapping both writes:
  //   1. Payment status update uses WHERE status = 'pending' (conditional) to close
  //      the TOCTOU window between the earlier status pre-check and this write.
  //      If a concurrent approval already committed, 0 rows match and we return null.
  //   2. Subscription extension is a single atomic SQL statement — no separate SELECT —
  //      so PostgreSQL row-level locking prevents lost-updates even under concurrency.
  //   If the driver row is missing, the transaction throws and rolls back step 1 too,
  //   preventing an "approved" payment with no matching subscription extension.
  const txResult = await db.transaction(async (tx) => {
    const [markedPayment] = await tx
      .update(subscriptionPaymentsTable)
      .set({ status: "approved", reviewedAt: now })
      .where(and(
        eq(subscriptionPaymentsTable.id, paymentId),
        eq(subscriptionPaymentsTable.status, "pending"),
      ))
      .returning({ id: subscriptionPaymentsTable.id });

    if (!markedPayment) {
      // Another concurrent approval already committed — signal 409 to caller.
      return null;
    }

    // Read the current value for audit logging only — the UPDATE below is atomic
    // and does not use this variable in its computation.
    const [beforeRow] = await tx
      .select({ subscriptionExpiresAt: usersTable.subscriptionExpiresAt })
      .from(usersTable)
      .where(eq(usersTable.id, payment.driverId));
    const beforeApprove = beforeRow?.subscriptionExpiresAt ?? null;

    req.log.info(
      {
        endpoint:  "POST /admin/payments/:paymentId/approve",
        driverId:  payment.driverId,
        paymentId,
        before:    beforeApprove?.toISOString() ?? null,
        daysToAdd,
        utcNow:    new Date().toISOString(),
      },
      "[SUBSCRIPTION WRITE PRE] approve"
    );

    // GREATEST(COALESCE(subscription_expires_at, NOW()), NOW()) means:
    //   • driver still active  → stack from future expiry (no days lost)
    //   • driver expired / null → stack from NOW
    const [updated] = await tx
      .update(usersTable)
      .set({
        subscriptionExpiresAt: sql`GREATEST(COALESCE(${usersTable.subscriptionExpiresAt}, NOW()), NOW()) + (${daysToAdd} * INTERVAL '1 day')`,
      })
      .where(eq(usersTable.id, payment.driverId))
      .returning({ subscriptionExpiresAt: usersTable.subscriptionExpiresAt });

    if (!updated?.subscriptionExpiresAt) {
      // Driver row missing — throw to roll back the payment status update too.
      throw new Error("driver_not_found");
    }

    req.log.info(
      {
        endpoint:  "POST /admin/payments/:paymentId/approve",
        driverId:  payment.driverId,
        paymentId,
        before:    beforeApprove?.toISOString() ?? null,
        after:     updated.subscriptionExpiresAt.toISOString(),
        daysAdded: daysToAdd,
        utcNow:    new Date().toISOString(),
      },
      "[SUBSCRIPTION WRITE POST] approve"
    );

    return updated.subscriptionExpiresAt;
  });

  if (txResult === null) {
    res.status(409).json({
      error: "لا يمكن الموافقة على هذا الدفع",
      detail: "تمت معالجة هذه الدفعة مسبقاً.",
    });
    return;
  }

  const newExpiry = txResult;

  // Targeted announcement (persistent in-app record)
  await insertTargetedAnnouncement(
    payment.driverId,
    "تم قبول دفعتك ✅",
    `تم إضافة ${daysToAdd} يوم إلى حسابك. ينتهي اشتراكك في: ${newExpiry.toLocaleDateString("ar-DZ")}.`
  );

  // Targeted Socket.io event — delivered ONLY to this driver's private room.
  // No other driver receives this event.
  emitToUser(payment.driverId, "subscription_approved", {
    newExpiry: newExpiry.toISOString(),
    daysAdded: daysToAdd,
  });

  req.log.info({ paymentId, driverId: payment.driverId, months, daysToAdd, newExpiry }, "Payment approved");
  res.json({
    ok: true,
    paymentId,
    driverId: payment.driverId,
    months,
    daysAdded: daysToAdd,
    newSubscriptionExpiresAt: newExpiry.toISOString(),
  });
});

// POST /admin/payments/:paymentId/reject
router.post("/admin/payments/:paymentId/reject", async (req, res): Promise<void> => {
  const { paymentId } = req.params;
  const { reason } = req.body as { reason?: string };

  const [payment] = await db
    .select({
      id:       subscriptionPaymentsTable.id,
      driverId: subscriptionPaymentsTable.driverId,
    })
    .from(subscriptionPaymentsTable)
    .where(eq(subscriptionPaymentsTable.id, paymentId));

  if (!payment) {
    res.status(404).json({ error: "الدفع غير موجود" });
    return;
  }

  await db
    .update(subscriptionPaymentsTable)
    .set({ status: "rejected", reviewedAt: new Date(), adminNotes: reason ?? null })
    .where(eq(subscriptionPaymentsTable.id, paymentId));

  await insertTargetedAnnouncement(
    payment.driverId,
    "تواصل مع الإدارة",
    `${reason ?? "لم يتم قبول وصل الدفع."} للتواصل مع الإدارة: https://www.facebook.com/profile.php?id=61590856328769`
  );

  // Targeted Socket.io event — delivered ONLY to this driver's private room.
  // No other driver receives this event.
  emitToUser(payment.driverId, "payment_rejected", {
    reason: reason ?? null,
  });

  req.log.info({ paymentId, driverId: payment.driverId }, "Payment rejected");
  res.json({ ok: true, paymentId, driverId: payment.driverId, status: "rejected" });
});

// ═══════════════════════════════════════════════════════════════════════
// SUPPORT CHAT MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════

// GET /admin/support/threads
// Lists all users who have ever sent a support message, sorted by most
// recent activity. Returns one entry per thread with the last message
// preview and a count of unread (pending) user messages.
router.get("/admin/support/threads", async (req, res): Promise<void> => {
  try {
    // One row per userId: latest message text + timestamp, pending count.
    // We pull every support message and aggregate in JS to avoid complex
    // SQL that would differ between SQLite and Postgres dialects.
    const rows = await db
      .select({
        id:         supportMessagesTable.id,
        userId:     supportMessagesTable.userId,
        message:    supportMessagesTable.message,
        senderType: supportMessagesTable.senderType,
        status:     supportMessagesTable.status,
        createdAt:  supportMessagesTable.createdAt,
      })
      .from(supportMessagesTable)
      .orderBy(asc(supportMessagesTable.createdAt));

    // Group by userId
    const byUser = new Map<string, typeof rows>();
    for (const row of rows) {
      const uid = row.userId ?? "__anon__";
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push(row);
    }

    // Fetch user names for known userIds
    const knownIds = [...byUser.keys()].filter((k) => k !== "__anon__");
    let userMap = new Map<string, { name: string; phone: string; userType: string }>();
    if (knownIds.length > 0) {
      const users = await db
        .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, userType: usersTable.userType })
        .from(usersTable)
        .where(sql`${usersTable.id} = ANY(${sql.raw(`ARRAY[${knownIds.map(() => "?").join(",")}]`)})`);
      // Fallback: use a JS filter since Drizzle's inArray needs a non-empty array
      const usersFiltered = await db
        .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, userType: usersTable.userType })
        .from(usersTable);
      const knownSet = new Set(knownIds);
      for (const u of usersFiltered) {
        if (knownSet.has(u.id)) userMap.set(u.id, { name: u.name, phone: u.phone, userType: u.userType });
      }
    }

    // Build thread summaries
    const threads = [...byUser.entries()]
      .map(([uid, msgs]) => {
        const last = msgs[msgs.length - 1];
        const pendingCount = msgs.filter((m) => m.senderType === "user" && m.status === "pending").length;
        const user = uid !== "__anon__" ? userMap.get(uid) : undefined;
        return {
          userId:       uid === "__anon__" ? null : uid,
          userName:     user?.name ?? "مجهول",
          userPhone:    user?.phone ?? null,
          userType:     user?.userType ?? null,
          lastMessage:  last.message,
          lastMessageAt: last.createdAt,
          senderType:   last.senderType,
          pendingCount,
          totalMessages: msgs.length,
        };
      })
      .sort((a, b) =>
        new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime()
      );

    res.json({ threads });
  } catch (err) {
    req.log.error({ err }, "admin/support/threads: DB query failed");
    res.status(500).json({ error: "تعذّر جلب المحادثات" });
  }
});

// GET /admin/support/threads/:userId
// Full message history for one user + basic user profile info.
router.get("/admin/support/threads/:userId", async (req, res): Promise<void> => {
  const { userId } = req.params;
  try {
    const [user] = await db
      .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone, userType: usersTable.userType, wilaya: usersTable.wilaya, commune: usersTable.commune })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    const messages = await db
      .select()
      .from(supportMessagesTable)
      .where(eq(supportMessagesTable.userId, userId))
      .orderBy(asc(supportMessagesTable.createdAt));

    res.json({
      user: user ?? { id: userId, name: "مجهول", phone: null, userType: null, wilaya: null, commune: null },
      messages,
    });
  } catch (err) {
    req.log.error({ err }, "admin/support/threads/:userId: DB query failed");
    res.status(500).json({ error: "تعذّر جلب المحادثة" });
  }
});

// POST /admin/support/threads/:userId/reply
// Admin sends a reply to a user. Persists the message, marks all pending
// user messages as "replied", then pushes a Socket.io event to the user
// for instant delivery without a page refresh.
router.post("/admin/support/threads/:userId/reply", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const { message } = req.body as { message?: string };

  if (!message?.trim()) {
    res.status(400).json({ error: "الرسالة فارغة" });
    return;
  }

  try {
    // Insert admin reply
    const [row] = await db
      .insert(supportMessagesTable)
      .values({
        userId,
        message:    message.trim(),
        senderType: "admin",
        status:     "replied",
      })
      .returning();

    // Mark all pending user messages in this thread as replied
    await db
      .update(supportMessagesTable)
      .set({ status: "replied" })
      .where(
        and(
          eq(supportMessagesTable.userId, userId),
          eq(supportMessagesTable.senderType, "user"),
          eq(supportMessagesTable.status, "pending")
        )
      );

    // Real-time delivery — push to the user's Socket.io room instantly.
    // Falls back to Supabase Realtime postgres_changes on the client side
    // if the user is not connected via Socket.io.
    emitToUser(userId, "support_reply", { message: row });

    // Web Push — reaches the user even when the app tab is closed or the
    // phone screen is off.  Fails silently if VAPID keys are not configured
    // or the user has no push subscription.
    const preview = row.message.length > 60 ? row.message.slice(0, 60) + "…" : row.message;
    sendPushToUser(userId, {
      title: "رسالة جديدة من الدعم الفني",
      body:  preview,
      url:   "/",
    }).catch(() => {});

    req.log.info({ userId, messageId: row.id }, "✅ Admin replied to support thread");
    res.json({ message: row });
  } catch (err) {
    req.log.error({ err }, "admin/support/threads/:userId/reply: DB insert failed");
    res.status(500).json({ error: "تعذّر إرسال الرد" });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// USER FREEZE / UNFREEZE (suspend · ban · unsuspend · unban)
// ═══════════════════════════════════════════════════════════════════════
//
// These four PATCH endpoints are the single source of truth for toggling
// account_status to "suspended" or "banned" and back to "approved".
// After every successful DB write:
//   1. The blockFrozenAccounts status cache is instantly invalidated so
//      the next request by that user performs a fresh DB lookup.
//   2. emitToUser() fires an "account_status_changed" socket event to the
//      user's private room so an open app freezes/unfreezes in < 1 s.
//
// Protected by requireAdmin — X-Admin-Key must match ADMIN_API_KEY.

async function setUserAccountStatus(
  userId: string,
  newStatus: string
): Promise<boolean> {
  const result = await db
    .update(usersTable)
    .set({ accountStatus: newStatus })
    .where(eq(usersTable.id, userId));
  return (result.rowCount ?? 0) > 0;
}

// PATCH /admin/users/:userId/suspend — approved → suspended
router.patch("/admin/users/:userId/suspend", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const found = await setUserAccountStatus(userId, "suspended");
  if (!found) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
  invalidateAccountStatusCache(userId);
  emitToUser(userId, "account_status_changed", { accountStatus: "suspended" });
  req.log.info({ userId }, "Admin: user suspended");
  res.json({ ok: true, accountStatus: "suspended" });
});

// PATCH /admin/users/:userId/unsuspend — suspended → approved
router.patch("/admin/users/:userId/unsuspend", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const found = await setUserAccountStatus(userId, "approved");
  if (!found) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
  invalidateAccountStatusCache(userId);
  emitToUser(userId, "account_status_changed", { accountStatus: "approved" });
  req.log.info({ userId }, "Admin: user unsuspended");
  res.json({ ok: true, accountStatus: "approved" });
});

// PATCH /admin/users/:userId/ban — any status → banned
router.patch("/admin/users/:userId/ban", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const found = await setUserAccountStatus(userId, "banned");
  if (!found) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
  invalidateAccountStatusCache(userId);
  emitToUser(userId, "account_status_changed", { accountStatus: "banned" });
  req.log.info({ userId }, "Admin: user banned");
  res.json({ ok: true, accountStatus: "banned" });
});

// PATCH /admin/users/:userId/unban — banned → approved
router.patch("/admin/users/:userId/unban", async (req, res): Promise<void> => {
  const { userId } = req.params;
  const found = await setUserAccountStatus(userId, "approved");
  if (!found) { res.status(404).json({ error: "المستخدم غير موجود" }); return; }
  invalidateAccountStatusCache(userId);
  emitToUser(userId, "account_status_changed", { accountStatus: "approved" });
  req.log.info({ userId }, "Admin: user unbanned");
  res.json({ ok: true, accountStatus: "approved" });
});

export default router;
