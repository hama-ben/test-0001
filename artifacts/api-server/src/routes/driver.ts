import { Router, type IRouter } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { db, driverStatusTable, usersTable, ordersTable, subscriptionPaymentsTable, driverDetailsTable, driverAppealsTable } from "@workspace/db";
import { UpdateDriverStatusBody } from "@workspace/api-zod";
import multer from "multer";
import { getSupabaseAdmin } from "../lib/supabase-server";
import { signDriverDocUrl } from "../lib/storage-init";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ── File upload via service-role Supabase client ─────────────────────────────
// The frontend cannot upload directly to Supabase storage because the new
// project has RLS enabled with no anon-insert policy. The service-role key
// bypasses RLS entirely and must stay server-side.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB — matches bucket limit. Plenty for a phone photo of a document; keeps memory/bandwidth per upload bounded.
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/jpg", "image/png", "image/webp", "video/mp4", "video/quicktime"];
    cb(null, allowed.includes(file.mimetype));
  },
});

const DRIVER_DOCS_BUCKET = "driver-documents";
const ALLOWED_SLOTS = ["truck-front", "license"] as const;
type UploadSlot = typeof ALLOWED_SLOTS[number];

router.post("/driver/upload-file", upload.single("file"), async (req, res): Promise<void> => {
  const { slot } = req.body as { slot?: string };

  // SECURITY: driverId must come from the verified JWT (req.auth), never from
  // the request body. Trusting a client-supplied driverId here would let any
  // authenticated driver overwrite another driver's license/truck photo
  // (upload uses upsert: true) just by changing a form field.
  const driverId = req.auth?.userId;

  if (!driverId || !slot) {
    res.status(400).json({ error: "driverId و slot مطلوبان" });
    return;
  }

  if (!ALLOWED_SLOTS.includes(slot as UploadSlot)) {
    res.status(400).json({ error: "قيمة slot غير صالحة" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "لم يتم إرفاق ملف" });
    return;
  }

  const client = getSupabaseAdmin();
  if (!client) {
    res.status(503).json({ error: "خدمة التخزين غير متاحة" });
    return;
  }

  try {
    const ext = req.file.originalname.split(".").pop() ?? "bin";
    const storagePath = `${driverId}/${slot}.${ext}`;

    const { error: uploadError } = await client.storage
      .from(DRIVER_DOCS_BUCKET)
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,
      });

    if (uploadError) {
      logger.warn({ err: uploadError.message, driverId, slot }, "Driver file upload failed");
      res.status(500).json({ error: `فشل رفع الملف: ${uploadError.message}` });
      return;
    }

    // Store the bare path, not a public URL — the bucket is private now.
    // A signed URL is generated fresh on every read (see signDriverDocUrl),
    // never persisted, so a leaked link expires within the hour instead of
    // staying valid forever.
    const previewUrl = await signDriverDocUrl(storagePath);
    logger.info({ driverId, slot, path: storagePath }, "Driver file uploaded via service role");
    res.json({ url: storagePath, previewUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, driverId, slot }, "Unexpected error during driver file upload");
    res.status(500).json({ error: msg });
  }
});

router.get("/driver/status", async (_req, res): Promise<void> => {
  const statuses = await db
    .select({
      driverId: driverStatusTable.driverId,
      driverName: usersTable.name,
      currentStatus: driverStatusTable.currentStatus,
      updatedAt: driverStatusTable.updatedAt,
    })
    .from(driverStatusTable)
    .leftJoin(usersTable, eq(driverStatusTable.driverId, usersTable.id));

  res.json(
    statuses.map((s) => ({
      driverId: s.driverId,
      driverName: s.driverName ?? "سائق",
      currentStatus: s.currentStatus,
      updatedAt: s.updatedAt.toISOString(),
    }))
  );
});

router.post("/driver/status", async (req, res): Promise<void> => {
  const parsed = UpdateDriverStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { driverId, currentStatus } = parsed.data;

  const [status] = await db
    .insert(driverStatusTable)
    .values({ driverId, currentStatus })
    .onConflictDoUpdate({
      target: driverStatusTable.driverId,
      set: { currentStatus, updatedAt: new Date() },
    })
    .returning();

  const [user] = await db
    .select({ name: usersTable.name })
    .from(usersTable)
    .where(eq(usersTable.id, driverId));

  req.log.info({ driverId, currentStatus }, "Driver status updated");

  res.json({
    driverId: status.driverId,
    driverName: user?.name ?? "سائق",
    currentStatus: status.currentStatus,
    updatedAt: status.updatedAt.toISOString(),
  });
});

router.get("/driver/:driverId/account", async (req, res): Promise<void> => {
  const driverId = Array.isArray(req.params.driverId)
    ? req.params.driverId[0]
    : req.params.driverId;

  const [user] = await db
    .select({
      accountStatus: usersTable.accountStatus,
      subscriptionExpiresAt: usersTable.subscriptionExpiresAt,
      freeTrialClaimed: usersTable.freeTrialClaimed,
    })
    .from(usersTable)
    .where(eq(usersTable.id, driverId));

  if (!user) {
    res.status(404).json({ error: "السائق غير موجود" });
    return;
  }

  const [details] = await db
    .select({
      truckFrontPhotoUrl: driverDetailsTable.truckFrontPhotoUrl,
      driverLicenseUrl:   driverDetailsTable.driverLicenseUrl,
      isLegacyDriver:     driverDetailsTable.isLegacyDriver,
    })
    .from(driverDetailsTable)
    .where(eq(driverDetailsTable.driverId, driverId));

  const documentsUploaded = !!(details?.truckFrontPhotoUrl && details?.driverLicenseUrl);
  const isLegacyDriver    = details?.isLegacyDriver === true;

  const now = new Date();
  const realSubscriptionExpired =
    user.subscriptionExpiresAt !== null &&
    user.subscriptionExpiresAt !== undefined &&
    user.subscriptionExpiresAt <= now;

  // Temporary access grace period: if the driver's real balance has expired
  // (or never existed) but they have a subscription-payment receipt awaiting
  // admin review, let them keep receiving orders in the meantime. This is a
  // purely computed, read-time permission — it NEVER writes to
  // subscriptionExpiresAt, so there is nothing to "take back" if the receipt
  // is later rejected. If approved, the real balance is extended for real by
  // the admin-approval endpoint, independently of this flag.
  let pendingReceiptGraceActive = false;
  if (realSubscriptionExpired) {
    const [pendingPayment] = await db
      .select({ id: subscriptionPaymentsTable.id })
      .from(subscriptionPaymentsTable)
      .where(and(
        eq(subscriptionPaymentsTable.driverId, driverId),
        eq(subscriptionPaymentsTable.status, "pending"),
      ))
      .limit(1);
    pendingReceiptGraceActive = !!pendingPayment;
  }

  // What the app should actually treat as "blocked from receiving orders".
  // True real balance always wins; the grace flag only ever loosens this
  // when the real balance is expired and a receipt is genuinely pending.
  const subscriptionExpired = realSubscriptionExpired && !pendingReceiptGraceActive;

  res.json({
    accountStatus: user.accountStatus,
    subscriptionExpiresAt: user.subscriptionExpiresAt
      ? user.subscriptionExpiresAt.toISOString()
      : null,
    subscriptionExpired,
    pendingReceiptGraceActive,
    freeTrialClaimed: user.freeTrialClaimed ?? false,
    documentsUploaded,
    isLegacyDriver,
  });
});

router.patch("/driver/:driverId/account", async (req, res): Promise<void> => {
  const driverId = Array.isArray(req.params.driverId)
    ? req.params.driverId[0]
    : req.params.driverId;

  const { accountStatus, subscriptionExpiresAt } = req.body as {
    accountStatus?: string;
    subscriptionExpiresAt?: string | null;
  };

  if (
    accountStatus !== undefined &&
    accountStatus !== "pending" &&
    accountStatus !== "active"
  ) {
    res.status(400).json({ error: "حالة الحساب غير صالحة" });
    return;
  }

  const updateData: Record<string, unknown> = {};
  if (accountStatus !== undefined) updateData.accountStatus = accountStatus;
  if (subscriptionExpiresAt !== undefined) {
    updateData.subscriptionExpiresAt =
      subscriptionExpiresAt ? new Date(subscriptionExpiresAt) : null;
  }

  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updateData)
    .where(eq(usersTable.id, driverId))
    .returning({
      accountStatus: usersTable.accountStatus,
      subscriptionExpiresAt: usersTable.subscriptionExpiresAt,
    });

  if (!updated) {
    res.status(404).json({ error: "السائق غير موجود" });
    return;
  }

  const now = new Date();
  const subscriptionExpired =
    updated.subscriptionExpiresAt !== null &&
    updated.subscriptionExpiresAt !== undefined &&
    updated.subscriptionExpiresAt <= now;

  res.json({
    accountStatus: updated.accountStatus,
    subscriptionExpiresAt: updated.subscriptionExpiresAt
      ? updated.subscriptionExpiresAt.toISOString()
      : null,
    subscriptionExpired,
  });
});

// ─── Submit driver verification document URLs ────────────────────────────────
// [تعديل 1 & 2]: لم تعد truckVideoUrl و truckSidePhotoUrl مطلوبتين
// يُكتفى الآن بصورة الأمام ورخصة القيادة فقط
router.post("/driver/:driverId/docs", async (req, res): Promise<void> => {
  const driverId = Array.isArray(req.params.driverId)
    ? req.params.driverId[0]
    : req.params.driverId;

  const { truckFrontPhotoUrl, driverLicenseUrl, truckVideoUrl, truckSidePhotoUrl } =
    req.body as {
      truckFrontPhotoUrl?: string;
      driverLicenseUrl?: string;
      truckVideoUrl?: string;       // اختياري — محتفظ به للتوافق مع القديم
      truckSidePhotoUrl?: string;   // اختياري — محتفظ به للتوافق مع القديم
    };

  // التحقق من الحقول الإلزامية الجديدة فقط
  if (!truckFrontPhotoUrl || !driverLicenseUrl) {
    res.status(400).json({ error: "صورة الشاحنة من الأمام ورخصة القيادة مطلوبتان" });
    return;
  }

  const [existing] = await db
    .select({ driverId: driverDetailsTable.driverId, trialGrantedAt: driverDetailsTable.trialGrantedAt })
    .from(driverDetailsTable)
    .where(eq(driverDetailsTable.driverId, driverId));

  if (!existing) {
    res.status(404).json({ error: "السائق غير موجود" });
    return;
  }

  const now = new Date();
  const trialAlreadyGranted = existing.trialGrantedAt !== null;

  const [updated] = await db
    .update(driverDetailsTable)
    .set({
      truckFrontPhotoUrl,
      driverLicenseUrl,
      truckVideoUrl:     truckVideoUrl     ?? "",
      truckSidePhotoUrl: truckSidePhotoUrl ?? "",
      // Only stamp trialGrantedAt the very first time documents are submitted
      ...(trialAlreadyGranted ? {} : { trialGrantedAt: now }),
    })
    .where(eq(driverDetailsTable.driverId, driverId))
    .returning();

  // ── Set account to pending + grant 3-day trial (first submission only) ──
  // Defense-in-depth: even though this branch is already gated by
  // `trialAlreadyGranted` (stamped once in driverDetailsTable.trialGrantedAt),
  // the actual subscriptionExpiresAt write uses the same atomic SQL CASE
  // guard as the receipt-upload bonus, so it can NEVER reduce an existing
  // future expiry — regardless of what triggers this route or how the
  // trialAlreadyGranted gate is computed.
  const [docsBonusResult] = await db
    .update(usersTable)
    .set({
      accountStatus: "pending",
      ...(!trialAlreadyGranted
        ? {
            subscriptionExpiresAt: sql`CASE
              WHEN "subscription_expires_at" IS NULL
                OR "subscription_expires_at" < NOW() + INTERVAL '3 days'
              THEN NOW() + INTERVAL '3 days'
              ELSE "subscription_expires_at"
            END`,
          }
        : {}),
    })
    .where(eq(usersTable.id, driverId))
    .returning({ subscriptionExpiresAt: usersTable.subscriptionExpiresAt });

  req.log.info(
    {
      driverId,
      trialAlreadyGranted,
      subscriptionExpiresAt: docsBonusResult?.subscriptionExpiresAt?.toISOString() ?? null,
    },
    "Driver docs submitted — account pending, trial window applied (CASE-guarded)"
  );

  res.json({
    driverId:           updated.driverId,
    truckFrontPhotoUrl: await signDriverDocUrl(updated.truckFrontPhotoUrl),
    driverLicenseUrl:   await signDriverDocUrl(updated.driverLicenseUrl),
    truckVideoUrl:      await signDriverDocUrl(updated.truckVideoUrl),
    truckSidePhotoUrl:  await signDriverDocUrl(updated.truckSidePhotoUrl),
    accountStatus:      "pending",
    trialGranted:       !trialAlreadyGranted,
  });
});

router.get("/driver/:driverId/orders", async (req, res): Promise<void> => {
  const driverId = Array.isArray(req.params.driverId)
    ? req.params.driverId[0]
    : req.params.driverId;

  const orders = await db
    .select({
      id: ordersTable.id,
      userId: ordersTable.userId,
      driverId: ordersTable.driverId,
      userName: usersTable.name,
      userPhone: usersTable.phone,
      waterVolume: ordersTable.waterVolume,
      barrelCount: ordersTable.barrelCount,
      totalPrice: ordersTable.totalPrice,
      latitude: ordersTable.latitude,
      longitude: ordersTable.longitude,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .leftJoin(usersTable, eq(ordersTable.userId, usersTable.id))
    .where(
      sql`${ordersTable.driverId} = ${driverId} AND ${ordersTable.status} IN ('قيد التوصيل', 'وصل السائق')`
    )
    .orderBy(desc(ordersTable.createdAt));

  res.json(
    orders.map((o) => ({
      id: o.id,
      userId: o.userId,
      driverId: o.driverId ?? null,
      userName: o.userName ?? null,
      userPhone: o.userPhone ?? null,
      waterVolume: o.waterVolume,
      barrelCount: o.barrelCount,
      totalPrice: Number(o.totalPrice),
      latitude: o.latitude !== null ? Number(o.latitude) : null,
      longitude: o.longitude !== null ? Number(o.longitude) : null,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
    }))
  );
});

router.get("/driver/:driverId/subscription", async (req, res): Promise<void> => {
  const driverId = Array.isArray(req.params.driverId)
    ? req.params.driverId[0]
    : req.params.driverId;

  const [payment] = await db
    .select()
    .from(subscriptionPaymentsTable)
    .where(eq(subscriptionPaymentsTable.driverId, driverId))
    .orderBy(desc(subscriptionPaymentsTable.createdAt))
    .limit(1);

  if (!payment) {
    res.status(404).json({ error: "لا توجد مدفوعات مسجلة" });
    return;
  }

  res.json({
    id: payment.id,
    driverId: payment.driverId,
    receiptImage: payment.receiptImage,
    status: payment.status,
    adminNotes: payment.adminNotes ?? null,
    createdAt: payment.createdAt.toISOString(),
    reviewedAt: payment.reviewedAt ? payment.reviewedAt.toISOString() : null,
  });
});

router.post("/driver/:driverId/subscription", async (req, res): Promise<void> => {
  const driverId = Array.isArray(req.params.driverId)
    ? req.params.driverId[0]
    : req.params.driverId;

  // IDOR guard: the authenticated user must be the driver named in the URL.
  if (!req.auth?.userId || req.auth.userId !== driverId) {
    res.status(403).json({ error: "غير مصرح لك بتقديم وصل لهذا الحساب" });
    return;
  }

  const { receiptImage, months: rawMonths } = req.body as { receiptImage?: string; months?: unknown };

  if (!receiptImage || typeof receiptImage !== "string") {
    res.status(400).json({ error: "صورة الوصل مطلوبة" });
    return;
  }

  // Accept months as a number OR numeric string (belt-and-suspenders).
  // Falls back to 1 if absent, out of range, or non-numeric.
  const parsedMonths = typeof rawMonths === "number"
    ? rawMonths
    : typeof rawMonths === "string"
      ? parseFloat(rawMonths)
      : NaN;
  const months = Number.isFinite(parsedMonths) && parsedMonths >= 1 && parsedMonths <= 12
    ? Math.round(parsedMonths)
    : 1;

  req.log.info(
    { driverId, receivedMonthsRaw: rawMonths, parsedMonths, monthsFinal: months },
    "Subscription receipt — months parsed"
  );

  const [user] = await db
    .select({ id: usersTable.id, subscriptionExpiresAt: usersTable.subscriptionExpiresAt })
    .from(usersTable)
    .where(eq(usersTable.id, driverId));

  if (!user) {
    res.status(404).json({ error: "السائق غير موجود" });
    return;
  }

  const [payment] = await db
    .insert(subscriptionPaymentsTable)
    .values({ driverId, receiptImage, months, status: "pending" })
    .returning();

  // IMPORTANT: uploading a receipt must NEVER change subscriptionExpiresAt
  // by itself. The balance stays exactly as it was — whatever that is —
  // until an admin explicitly approves or rejects this payment. The only
  // write to subscriptionExpiresAt for the receipt flow happens in
  // POST /admin/payments/:paymentId/approve (admin.ts), and it is always
  // additive on top of the existing value.
  req.log.info(
    {
      endpoint:  "POST /driver/:driverId/subscription",
      driverId,
      paymentId: payment.id,
      months:    payment.months,
      existingSubscriptionExpiresAt: user.subscriptionExpiresAt?.toISOString() ?? null,
    },
    "Subscription receipt submitted — pending admin review, balance left untouched"
  );

  res.status(201).json({
    id: payment.id,
    driverId: payment.driverId,
    receiptImage: payment.receiptImage,
    months: payment.months,
    status: payment.status,
    adminNotes: payment.adminNotes ?? null,
    createdAt: payment.createdAt.toISOString(),
    reviewedAt: payment.reviewedAt ? payment.reviewedAt.toISOString() : null,
  });
});

router.post("/driver/:driverId/free-trial", async (req, res): Promise<void> => {
  const driverId = Array.isArray(req.params.driverId)
    ? req.params.driverId[0]
    : req.params.driverId;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, driverId));

  if (!user) {
    res.status(404).json({ error: "السائق غير موجود" });
    return;
  }
  if (user.userType !== "سائق") {
    res.status(403).json({ error: "مسموح فقط للسائقين" });
    return;
  }
  if (user.freeTrialClaimed) {
    res.status(409).json({ error: "لقد استخدمت نسختك التجريبية المجانية مسبقاً" });
    return;
  }

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db
    .update(usersTable)
    .set({ subscriptionExpiresAt: expiresAt, freeTrialClaimed: true })
    .where(eq(usersTable.id, driverId));

  req.log.info({ driverId, expiresAt }, "Free trial granted");
  res.json({ subscriptionExpiresAt: expiresAt.toISOString(), trial: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// /driver/appeal — REMOVED (moved to /appeal in routes/appeals.ts)
// Kept as thin redirects for the 30-day grace period in case any older
// version of the app still calls the old URL.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/driver/appeal", (req, res) => res.redirect(307, "/appeal"));
router.post("/driver/appeal", (req, res) => res.redirect(307, "/appeal"));

export default router;
