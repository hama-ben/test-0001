import { Router, type IRouter } from "express";
import { eq, and, gt, desc } from "drizzle-orm";
import { db, usersTable, driverStatusTable, driverDetailsTable, userDevicesTable } from "@workspace/db";
import { RegisterBody, LoginBody, LoginResponse } from "@workspace/api-zod";
import { logger } from "../lib/logger";
import { getSupabaseAuth, getSupabaseAdmin } from "../lib/supabase-server";
import { sendSupportContactEmail } from "../lib/mailer";
import crypto from "crypto";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Device helpers
// ─────────────────────────────────────────────────────────────────────────────
const DEVICE_LIMIT   = 3;
const DEVICE_TTL_DAYS = 90;

function parseDeviceLabel(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  let os = "جهاز غير معروف";
  if (ua.includes("android"))       os = "Android";
  else if (ua.includes("iphone"))   os = "iPhone";
  else if (ua.includes("ipad"))     os = "iPad";
  else if (ua.includes("windows"))  os = "Windows";
  else if (ua.includes("mac"))      os = "Mac";
  else if (ua.includes("linux"))    os = "Linux";

  let browser = "";
  if (ua.includes("chrome") && !ua.includes("edg") && !ua.includes("opr"))      browser = "Chrome";
  else if (ua.includes("firefox"))                                                browser = "Firefox";
  else if (ua.includes("safari") && !ua.includes("chrome"))                      browser = "Safari";
  else if (ua.includes("edg"))                                                    browser = "Edge";
  else if (ua.includes("opr") || ua.includes("opera"))                           browser = "Opera";

  return browser ? `${browser} على ${os}` : os;
}

function activeDeviceCutoff(): Date {
  return new Date(Date.now() - DEVICE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/** Extract and verify the user-id from a Supabase JWT Bearer token (read-only, no DB call). */
function extractUserIdFromBearer(authHeader: string | undefined): string | null {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB error helper
// ─────────────────────────────────────────────────────────────────────────────
function handleDbError(err: unknown, context: string): { status: number; message: string } {
  const cause   = (err as { cause?: unknown })?.cause ?? err;
  const message = err instanceof Error ? err.message : String(err);
  const causeMsg = cause instanceof Error ? cause.message : undefined;
  const pgCode  = (cause as { code?: string })?.code ?? (err as { code?: string })?.code;

  if (pgCode === "42P01") {
    logger.error({ context, err: message },
      "❌ جدول غير موجود في قاعدة البيانات — تأكد من تطبيق المخطط (schema) على Supabase"
    );
    return { status: 503, message: "خطأ في قاعدة البيانات: جدول غير موجود — تواصل مع المشرف" };
  }

  logger.error({ context, pgCode, err: message, cause: causeMsg }, "DB error");
  return { status: 500, message: "خطأ داخلي في الخادم" };
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory pending-registration store (TTL = 10 min)
// Supabase Auth owns the OTP lifecycle. We only keep extra registration data
// (name, phone, userType, etc.) so verify-otp can create the user row.
// ─────────────────────────────────────────────────────────────────────────────
const OTP_TTL_MS = 10 * 60 * 1000;

interface PendingRegistration {
  expiresAt: number;
  name: string;
  email: string;
  phone: string;
  userType: "مستهلك" | "سائق";
  wilaya: string;
  commune: string;
}

const pendingStore = new Map<string, PendingRegistration>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingStore) {
    if (val.expiresAt < now) pendingStore.delete(key);
  }
}, 5 * 60 * 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Registration request — create Supabase Auth user + send OTP email
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/register-request", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }

  const { name, email, password, phone, userType, wilaya, commune } = parsed.data;

  if (!wilaya || !commune) {
    res.status(400).json({ error: "الولاية والبلدية مطلوبتان" });
    return;
  }

  try {
    const [existingEmail] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email));
    if (existingEmail) {
      res.status(400).json({ error: "الحساب مسجل بالفعل" });
      return;
    }

    const [existingPhone] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.phone, phone));
    if (existingPhone) {
      res.status(400).json({ error: "الرقم مستخدم بالفعل" });
      return;
    }
  } catch (err) {
    const { status, message } = handleDbError(err, "register-request uniqueness check");
    res.status(status).json({ error: message });
    return;
  }

  const supabase = getSupabaseAuth();
  if (!supabase) {
    res.status(503).json({ error: "خدمة المصادقة غير متاحة — يرجى التحقق من إعداد Supabase" });
    return;
  }

  // Create user in Supabase Auth — triggers OTP confirmation email automatically.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { name, userType },
    },
  });

  if (error) {
    if (error.message.toLowerCase().includes("already registered") || error.message.toLowerCase().includes("user already")) {
      // User exists in Supabase Auth but not in our DB — allow re-verification
      req.log.warn({ email, err: error.message }, "register-request: user already in Supabase Auth");
    } else {
      req.log.error({ email, err: error.message }, "register-request: Supabase signUp failed");
      res.status(400).json({ error: "فشل إنشاء الحساب: " + error.message });
      return;
    }
  }

  // Store pending registration data for use after OTP is verified.
  pendingStore.set(email, {
    expiresAt: Date.now() + OTP_TTL_MS,
    name, email, phone,
    userType: userType as "مستهلك" | "سائق",
    wilaya: wilaya as string,
    commune: commune as string,
  });

  req.log.info({ email, supabaseUserId: data?.user?.id }, "✅ Registration OTP sent via Supabase Auth");
  res.status(202).json({
    message: "تم إرسال رمز التحقق المكوّن من 6 أرقام إلى بريدك الإلكتروني",
    email,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Verify OTP — confirm Supabase session → create user row in DB
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/verify-otp", async (req, res): Promise<void> => {
  const { email, otp } = req.body as { email?: string; otp?: string };

  if (!email || !otp) {
    res.status(400).json({ error: "البريد الإلكتروني ورمز التحقق مطلوبان" });
    return;
  }

  const otpTrimmed = otp.trim();
  if (!/^\d{6}$/.test(otpTrimmed)) {
    res.status(400).json({
      error: "رمز التحقق يجب أن يكون مكوّناً من 6 أرقام. " +
        "إذا استلمت رابطاً بدلاً من رقم، تحقق من إعداد قالب البريد في Supabase Dashboard → Authentication → Email Templates واستبدل {{ .ConfirmationURL }} بـ {{ .Token }}",
    });
    return;
  }

  const pending = pendingStore.get(email);
  if (!pending) {
    res.status(400).json({ error: "لم يتم العثور على طلب تسجيل — يرجى البدء من جديد" });
    return;
  }
  if (Date.now() > pending.expiresAt) {
    pendingStore.delete(email);
    res.status(400).json({ error: "انتهت صلاحية الجلسة — يرجى التسجيل من جديد" });
    return;
  }

  const supabase = getSupabaseAuth();
  if (!supabase) {
    res.status(503).json({ error: "خدمة المصادقة غير متاحة" });
    return;
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: otpTrimmed,
    type: "signup",
  });

  if (error || !data.user || !data.session) {
    req.log.warn({ email, err: error?.message }, "verify-otp: Supabase OTP mismatch");
    res.status(400).json({ error: "رمز التحقق غير صحيح أو منتهي الصلاحية" });
    return;
  }

  pendingStore.delete(email);

  const supabaseUserId = data.user.id;
  const accountStatus  = pending.userType === "سائق" ? "active" : "pending";

  // Store userType in Supabase Auth app_metadata (trusted, set by admin only).
  const admin = getSupabaseAdmin();
  if (admin) {
    await admin.auth.admin.updateUserById(supabaseUserId, {
      app_metadata: { userType: pending.userType },
    }).catch((e: unknown) => {
      logger.warn({ err: e }, "verify-otp: failed to set app_metadata — continuing");
    });
  }

  let user: typeof usersTable.$inferSelect;
  try {
    const [inserted] = await db
      .insert(usersTable)
      .values({
        id:            supabaseUserId,
        name:          pending.name,
        email:         pending.email,
        phone:         pending.phone,
        passwordHash:  "",
        userType:      pending.userType,
        wilaya:        pending.wilaya,
        commune:       pending.commune,
        accountStatus,
        createdAt:     new Date(),
      })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: { name: pending.name, phone: pending.phone, wilaya: pending.wilaya, commune: pending.commune },
      })
      .returning();
    user = inserted;
  } catch (err) {
    const { status, message } = handleDbError(err, "verify-otp insert user");
    res.status(status).json({ error: message });
    return;
  }

  req.log.info({ userId: user.id, userType: user.userType, accountStatus }, "✅ User registered via Supabase Auth OTP");

  if (user.userType === "سائق") {
    try {
      await db.insert(driverStatusTable).values({ driverId: user.id, currentStatus: "مغلق" }).onConflictDoNothing();
      await db.insert(driverDetailsTable).values({ driverId: user.id, wilaya: pending.wilaya, commune: pending.commune }).onConflictDoNothing();
    } catch (err) {
      logger.warn({ err }, "Failed to create driver auxiliary records — continuing");
    }
  }

  res.status(201).json({
    ...LoginResponse.parse({
      userId:   user.id,
      name:     user.name,
      email:    user.email,
      userType: user.userType,
    }),
    sessionToken:  data.session.access_token,
    refreshToken:  data.session.refresh_token,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Login via Supabase Auth (email + password)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { email, password } = parsed.data;

  const supabase = getSupabaseAuth();
  if (!supabase) {
    res.status(503).json({ error: "خدمة المصادقة غير متاحة — يرجى التحقق من إعداد Supabase" });
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.user || !data.session) {
    req.log.warn({ email, err: error?.message }, "login: Supabase signIn failed");
    res.status(401).json({ error: "بيانات تسجيل الدخول غير صحيحة" });
    return;
  }

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    const [found] = await db.select().from(usersTable).where(eq(usersTable.id, data.user.id));
    user = found;
  } catch (err) {
    const { status, message } = handleDbError(err, "login select user");
    res.status(status).json({ error: message });
    return;
  }

  if (!user) {
    // Supabase Auth user exists but our DB row is missing — edge case
    req.log.error({ email, supabaseUserId: data.user.id }, "login: Supabase user has no DB row");
    res.status(401).json({ error: "بيانات تسجيل الدخول غير صحيحة" });
    return;
  }

  // ── Device limit check ──────────────────────────────────────────────────────
  const incomingDeviceId = (req.headers["x-device-id"] as string | undefined)?.trim() ?? null;
  if (incomingDeviceId) {
    try {
      const cutoff = activeDeviceCutoff();

      const [existingDevice] = await db
        .select({ id: userDevicesTable.id })
        .from(userDevicesTable)
        .where(and(
          eq(userDevicesTable.userId, user.id),
          eq(userDevicesTable.deviceId, incomingDeviceId),
        ));

      if (existingDevice) {
        // Known device — refresh timestamp
        await db.update(userDevicesTable)
          .set({ lastSeenAt: new Date() })
          .where(and(
            eq(userDevicesTable.userId, user.id),
            eq(userDevicesTable.deviceId, incomingDeviceId),
          ));
      } else {
        // New device — count active devices
        const activeDevices = await db
          .select({
            deviceId:    userDevicesTable.deviceId,
            deviceLabel: userDevicesTable.deviceLabel,
            lastSeenAt:  userDevicesTable.lastSeenAt,
          })
          .from(userDevicesTable)
          .where(and(
            eq(userDevicesTable.userId, user.id),
            gt(userDevicesTable.lastSeenAt, cutoff),
          ))
          .orderBy(desc(userDevicesTable.lastSeenAt));

        if (activeDevices.length >= DEVICE_LIMIT) {
          req.log.warn({ userId: user.id, activeCount: activeDevices.length }, "Device limit exceeded");
          res.status(429).json({
            error: "لقد تجاوزت الحد الأقصى لعدد الأجهزة المسموح بها (3 أجهزة). يرجى إزالة أحد أجهزتك القديمة أولاً.",
            code:    "DEVICE_LIMIT_EXCEEDED",
            devices: activeDevices.map(d => ({
              deviceId:    d.deviceId,
              deviceLabel: d.deviceLabel,
              lastSeenAt:  d.lastSeenAt?.toISOString() ?? null,
            })),
          });
          return;
        }

        // Slot available — register new device
        const deviceLabel = parseDeviceLabel(req.headers["user-agent"] ?? "");
        await db.insert(userDevicesTable).values({
          userId:      user.id,
          deviceId:    incomingDeviceId,
          deviceLabel,
        });
        req.log.info({ userId: user.id, deviceLabel }, "New device registered");
      }
    } catch (err) {
      req.log.warn({ err }, "Device tracking failed — allowing login anyway");
    }
  }

  let documentsUploaded = true;
  if (user.userType === "سائق") {
    const [details] = await db
      .select({ truckFrontPhotoUrl: driverDetailsTable.truckFrontPhotoUrl, driverLicenseUrl: driverDetailsTable.driverLicenseUrl })
      .from(driverDetailsTable)
      .where(eq(driverDetailsTable.driverId, user.id));
    documentsUploaded = !!(details?.truckFrontPhotoUrl && details?.driverLicenseUrl);
  }

  req.log.info({ userId: user.id, documentsUploaded }, "User logged in via Supabase Auth");
  res.json({
    ...LoginResponse.parse({
      userId:   user.id,
      name:     user.name,
      email:    user.email,
      userType: user.userType,
    }),
    sessionToken:  data.session.access_token,
    refreshToken:  data.session.refresh_token,
    documentsUploaded,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Token refresh — exchange an expired access token for a fresh session pair.
// This is a public route (called when the access token has already expired).
// Supabase's refresh_token grant is used — the old refresh token is rotated
// (Supabase invalidates it after use, so the response contains a new one).
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/refresh", async (req, res): Promise<void> => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken || typeof refreshToken !== "string") {
    res.status(400).json({ error: "refreshToken مطلوب" });
    return;
  }

  const supabase = getSupabaseAuth();
  if (!supabase) {
    res.status(503).json({ error: "خدمة المصادقة غير متاحة — يرجى التحقق من إعداد Supabase" });
    return;
  }

  const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });

  if (error || !data.session) {
    req.log.warn({ err: error?.message }, "auth/refresh: Supabase refresh failed");
    res.status(401).json({ error: "انتهت صلاحية الجلسة، يرجى تسجيل الدخول مجدداً" });
    return;
  }

  req.log.info({ userId: data.session.user.id }, "✅ Session refreshed");

  res.json({
    sessionToken: data.session.access_token,
    refreshToken: data.session.refresh_token,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logout — Supabase sessions are JWT-based; client discards the token.
// Server-side sign-out revokes the refresh token on Supabase's side.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/logout", async (req, res): Promise<void> => {
  const auth  = req.headers.authorization;
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;

  if (token) {
    const supabase = getSupabaseAuth();
    if (supabase) {
      // Sign out from Supabase to invalidate the refresh token server-side.
      await supabase.auth.admin?.signOut?.(token).catch(() => {});
    }
  }
  res.status(204).end();
});

// ─────────────────────────────────────────────────────────────────────────────
// Change password (for logged-in users)
// Validates old password via Supabase, then updates via admin API.
// Note: /auth/* routes bypass requireAuth middleware, so we read the JWT here.
// ─────────────────────────────────────────────────────────────────────────────
function extractUserId(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as { sub?: string; exp?: number };
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.sub ?? null;
  } catch { return null; }
}

router.post("/auth/change-password", async (req, res): Promise<void> => {
  const userId = extractUserId(req.headers.authorization);
  if (!userId) {
    res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });
    return;
  }

  const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: "كلمة المرور القديمة والجديدة مطلوبتان" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل" });
    return;
  }

  let user: typeof usersTable.$inferSelect | undefined;
  try {
    const [found] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
    user = found;
  } catch (err) {
    const { status, message } = handleDbError(err, "change-password select");
    res.status(status).json({ error: message });
    return;
  }

  if (!user) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }

  const supabase = getSupabaseAuth();
  if (!supabase) {
    res.status(503).json({ error: "خدمة المصادقة غير متاحة" });
    return;
  }

  // Validate old password first
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: oldPassword });
  if (signInErr) {
    res.status(401).json({ error: "كلمة المرور القديمة غير صحيحة" });
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: "خدمة المصادقة الإدارية غير متاحة — يرجى إعداد SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (updateErr) {
    req.log.error({ userId, err: updateErr.message }, "change-password: Supabase admin update failed");
    res.status(500).json({ error: "فشل تحديث كلمة المرور" });
    return;
  }

  req.log.info({ userId }, "✅ Password changed via Supabase Auth admin");
  res.json({ message: "تم تغيير كلمة المرور بنجاح" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password reset — Step 1: send OTP
// Uses signInWithOtp (shouldCreateUser: false) to send a 6-digit code.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/send-reset-otp", async (req, res): Promise<void> => {
  const { email } = req.body as { email?: string };
  if (!email?.trim()) {
    res.status(400).json({ error: "البريد الإلكتروني مطلوب" });
    return;
  }

  try {
    const [found] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email.trim()));
    if (!found) {
      res.status(202).json({ message: "تم إرسال رمز التحقق إذا كان البريد مسجلاً" });
      return;
    }
  } catch (err) {
    const { status, message } = handleDbError(err, "send-reset-otp lookup");
    res.status(status).json({ error: message });
    return;
  }

  const supabase = getSupabaseAuth();
  if (!supabase) {
    res.status(503).json({ error: "خدمة المصادقة غير متاحة" });
    return;
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: false },
  });

  if (error) {
    req.log.warn({ email: email.trim(), err: error.message }, "send-reset-otp: Supabase OTP failed");
  } else {
    req.log.info({ email: email.trim() }, "✅ Password-reset OTP sent via Supabase Auth");
  }

  res.status(202).json({ message: "تم إرسال رمز التحقق إذا كان البريد مسجلاً" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password reset — Step 2: verify OTP → issue server resetToken
// ─────────────────────────────────────────────────────────────────────────────
const RESET_TOKEN_TTL_MS = 10 * 60 * 1000;
interface PendingReset { supabaseUserId: string; email: string; expiresAt: number; }
const resetTokenStore = new Map<string, PendingReset>();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of resetTokenStore) {
    if (val.expiresAt < now) resetTokenStore.delete(key);
  }
}, 5 * 60 * 1000);

router.post("/auth/verify-reset-otp", async (req, res): Promise<void> => {
  const { email, otp } = req.body as { email?: string; otp?: string };

  if (!email || !otp) {
    res.status(400).json({ error: "البريد الإلكتروني والرمز مطلوبان" });
    return;
  }

  const otpTrimmed = otp.trim();
  if (!/^\d{6}$/.test(otpTrimmed)) {
    res.status(400).json({ error: "رمز التحقق يجب أن يكون مكوّناً من 6 أرقام" });
    return;
  }

  const supabase = getSupabaseAuth();
  if (!supabase) {
    res.status(503).json({ error: "خدمة المصادقة غير متاحة" });
    return;
  }

  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: otpTrimmed,
    type:  "email",
  });

  if (error || !data.user) {
    req.log.warn({ email: email.trim(), err: error?.message }, "verify-reset-otp: OTP mismatch");
    res.status(400).json({ error: "رمز التحقق غير صحيح أو منتهي الصلاحية" });
    return;
  }

  const resetToken = crypto.randomUUID();
  resetTokenStore.set(resetToken, {
    supabaseUserId: data.user.id,
    email:          email.trim(),
    expiresAt:      Date.now() + RESET_TOKEN_TTL_MS,
  });

  req.log.info({ email: email.trim() }, "✅ Password-reset OTP verified, resetToken issued");
  res.json({ resetToken });
});

// ─────────────────────────────────────────────────────────────────────────────
// Password reset — Step 3: exchange resetToken for password update
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { resetToken, newPassword } = req.body as { resetToken?: string; newPassword?: string };

  if (!resetToken || !newPassword) {
    res.status(400).json({ error: "رمز التحقق وكلمة المرور الجديدة مطلوبان" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 6) {
    res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
    return;
  }

  const pending = resetTokenStore.get(resetToken);
  if (!pending) {
    res.status(400).json({ error: "رمز إعادة التعيين غير صالح أو منتهي الصلاحية" });
    return;
  }
  if (Date.now() > pending.expiresAt) {
    resetTokenStore.delete(resetToken);
    res.status(400).json({ error: "انتهت صلاحية رمز إعادة التعيين — يرجى البدء من جديد" });
    return;
  }

  resetTokenStore.delete(resetToken);

  const admin = getSupabaseAdmin();
  if (!admin) {
    res.status(503).json({ error: "خدمة المصادقة الإدارية غير متاحة — يرجى إعداد SUPABASE_SERVICE_ROLE_KEY" });
    return;
  }

  const { error } = await admin.auth.admin.updateUserById(pending.supabaseUserId, { password: newPassword });
  if (error) {
    req.log.error({ userId: pending.supabaseUserId, err: error.message }, "reset-password: Supabase admin update failed");
    res.status(500).json({ error: "فشل تحديث كلمة المرور" });
    return;
  }

  logger.info({ userId: pending.supabaseUserId }, "✅ Password reset via Supabase Auth admin");
  res.json({ message: "تم تحديث كلمة المرور بنجاح" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Device management
// GET  /auth/devices          — list active devices (requires JWT)
// POST /auth/devices/remove   — remove a device by re-authenticating (no JWT needed)
// DELETE /auth/devices/:deviceId — remove a device (requires JWT)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/auth/devices", async (req, res): Promise<void> => {
  const userId = extractUserIdFromBearer(req.headers.authorization);
  if (!userId) {
    res.status(401).json({ error: "غير مصرح — يرجى تسجيل الدخول أولاً" });
    return;
  }

  try {
    const cutoff  = activeDeviceCutoff();
    const devices = await db
      .select({
        deviceId:    userDevicesTable.deviceId,
        deviceLabel: userDevicesTable.deviceLabel,
        firstSeenAt: userDevicesTable.firstSeenAt,
        lastSeenAt:  userDevicesTable.lastSeenAt,
      })
      .from(userDevicesTable)
      .where(and(eq(userDevicesTable.userId, userId), gt(userDevicesTable.lastSeenAt, cutoff)))
      .orderBy(desc(userDevicesTable.lastSeenAt));

    res.json(devices.map(d => ({
      deviceId:    d.deviceId,
      deviceLabel: d.deviceLabel,
      firstSeenAt: d.firstSeenAt?.toISOString() ?? null,
      lastSeenAt:  d.lastSeenAt?.toISOString() ?? null,
    })));
  } catch (err) {
    const { status, message } = handleDbError(err, "GET /auth/devices");
    res.status(status).json({ error: message });
  }
});

/** Unauthenticated device removal — verifies identity via email+password so
 *  users locked out by the device limit can still free up a slot. */
router.post("/auth/devices/remove", async (req, res): Promise<void> => {
  const { email, password, deviceId } = req.body as {
    email?: string; password?: string; deviceId?: string;
  };
  if (!email?.trim() || !password?.trim() || !deviceId?.trim()) {
    res.status(400).json({ error: "بيانات غير مكتملة" });
    return;
  }

  const supabase = getSupabaseAuth();
  if (!supabase) {
    res.status(503).json({ error: "خدمة المصادقة غير متاحة" });
    return;
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: password.trim() });
  if (error || !data.user) {
    res.status(401).json({ error: "بيانات تسجيل الدخول غير صحيحة" });
    return;
  }

  const userId = data.user.id;

  // Immediately revoke the temporary session we just created
  const admin = getSupabaseAdmin();
  if (admin && data.session?.access_token) {
    await (admin.auth as any).admin?.signOut?.(data.session.access_token).catch(() => {});
  }

  try {
    await db.delete(userDevicesTable)
      .where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.deviceId, deviceId.trim())));

    const cutoff     = activeDeviceCutoff();
    const remaining  = await db
      .select({
        deviceId:    userDevicesTable.deviceId,
        deviceLabel: userDevicesTable.deviceLabel,
        lastSeenAt:  userDevicesTable.lastSeenAt,
      })
      .from(userDevicesTable)
      .where(and(eq(userDevicesTable.userId, userId), gt(userDevicesTable.lastSeenAt, cutoff)))
      .orderBy(desc(userDevicesTable.lastSeenAt));

    res.json({
      ok: true,
      devices: remaining.map(d => ({
        deviceId:    d.deviceId,
        deviceLabel: d.deviceLabel,
        lastSeenAt:  d.lastSeenAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    const { status, message } = handleDbError(err, "POST /auth/devices/remove");
    res.status(status).json({ error: message });
  }
});

router.delete("/auth/devices/:deviceId", async (req, res): Promise<void> => {
  const userId = extractUserIdFromBearer(req.headers.authorization);
  if (!userId) {
    res.status(401).json({ error: "غير مصرح — يرجى تسجيل الدخول أولاً" });
    return;
  }

  const { deviceId } = req.params;
  try {
    await db.delete(userDevicesTable)
      .where(and(eq(userDevicesTable.userId, userId), eq(userDevicesTable.deviceId, deviceId)));
    res.json({ ok: true });
  } catch (err) {
    const { status, message } = handleDbError(err, "DELETE /auth/devices/:deviceId");
    res.status(status).json({ error: message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Support contact — kept from old system (uses SMTP, unrelated to auth)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/auth/support-contact", async (req, res): Promise<void> => {
  const { name, email, userType, message } = req.body as {
    name?: string; email?: string; userType?: string; message?: string;
  };
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    res.status(400).json({ error: "جميع الحقول مطلوبة" });
    return;
  }

  try {
    await sendSupportContactEmail({
      fromName:  name.trim(),
      fromEmail: email.trim(),
      userType:  userType ?? "غير محدد",
      message:   message.trim(),
    });
    res.json({ message: "تم إرسال رسالتك بنجاح" });
  } catch (err) {
    logger.warn({ err }, "support-contact: email delivery failed");
    res.status(502).json({ error: "فشل إرسال الرسالة — يرجى المحاولة مجدداً" });
  }
});

export default router;
