/**
 * mailer.ts — Self-managed OTP email delivery
 *
 * Sends 6-digit numeric OTP codes via nodemailer (SMTP).
 *
 * Required env vars (set via Replit Secrets):
 *   SMTP_HOST     e.g. smtp.gmail.com
 *   SMTP_PORT     e.g. 587
 *   SMTP_USER     e.g. yourapp@gmail.com
 *   SMTP_PASS     Gmail App Password or SMTP password
 *   SMTP_FROM     Display name + address, e.g. "Mizu <yourapp@gmail.com>"
 *                 (defaults to SMTP_USER if not set)
 *
 * Development fallback:
 *   If SMTP_HOST is not set, the OTP is printed to the server console
 *   so development/testing works without SMTP credentials.
 */

import nodemailer from "nodemailer";
import { logger } from "./logger";

function getTransporter() {
  const host = process.env.SMTP_HOST?.trim();
  const port = parseInt(process.env.SMTP_PORT?.trim() ?? "587", 10);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

function fromAddress(): string {
  const from = process.env.SMTP_FROM?.trim();
  const user = process.env.SMTP_USER?.trim();
  return from ?? user ?? "Mizu <noreply@mizu.app>";
}

export async function sendOtpEmail(
  email: string,
  name: string,
  otp: string
): Promise<void> {
  const transporter = getTransporter();

  if (!transporter) {
    logger.warn(
      { email, otp },
      "⚠️  SMTP not configured — OTP printed to console (dev mode only)"
    );
    console.log(
      `\n╔══════════════════════════════════╗`,
      `\n║   رمز التحقق لـ ${email}`,
      `\n║   OTP CODE: ${otp}`,
      `\n╚══════════════════════════════════╝\n`
    );
    return;
  }

  const html = `
    <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:16px;">
      <h2 style="color:#0ea5e9;margin-bottom:8px;">مرحباً ${name || ""}،</h2>
      <p style="color:#374151;">رمز التحقق الخاص بك على تطبيق <strong>Mizu</strong>:</p>
      <div style="text-align:center;margin:24px 0;">
        <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#0f172a;background:#f0f9ff;padding:16px 24px;border-radius:12px;display:inline-block;">${otp}</span>
      </div>
      <p style="color:#6b7280;font-size:14px;">صالح لمدة 10 دقائق. لا تشاركه مع أي شخص.</p>
    </div>`;

  await transporter.sendMail({
    from: fromAddress(),
    to: email,
    subject: `${otp} — رمز التحقق من Mizu`,
    html,
    text: `رمز التحقق الخاص بك: ${otp}\nصالح لمدة 10 دقائق.`,
  });

  logger.info({ email }, "✅ OTP email sent via SMTP");
}

export async function sendPasswordResetOtpEmail(
  email: string,
  otp: string
): Promise<void> {
  const transporter = getTransporter();

  if (!transporter) {
    logger.warn(
      { email, otp },
      "⚠️  SMTP not configured — reset OTP printed to console (dev mode only)"
    );
    console.log(
      `\n╔══════════════════════════════════╗`,
      `\n║   رمز إعادة تعيين كلمة المرور لـ ${email}`,
      `\n║   RESET OTP: ${otp}`,
      `\n╚══════════════════════════════════╝\n`
    );
    return;
  }

  const html = `
    <div dir="rtl" style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:16px;">
      <h2 style="color:#f59e0b;margin-bottom:8px;">إعادة تعيين كلمة المرور</h2>
      <p style="color:#374151;">رمز إعادة تعيين كلمة المرور على تطبيق <strong>Mizu</strong>:</p>
      <div style="text-align:center;margin:24px 0;">
        <span style="font-size:40px;font-weight:900;letter-spacing:12px;color:#0f172a;background:#fffbeb;padding:16px 24px;border-radius:12px;display:inline-block;">${otp}</span>
      </div>
      <p style="color:#6b7280;font-size:14px;">صالح لمدة 10 دقائق. إذا لم تطلب ذلك، تجاهل هذا البريد.</p>
    </div>`;

  await transporter.sendMail({
    from: fromAddress(),
    to: email,
    subject: `${otp} — رمز إعادة تعيين كلمة المرور من Mizu`,
    html,
    text: `رمز إعادة تعيين كلمة المرور: ${otp}\nصالح لمدة 10 دقائق.`,
  });

  logger.info({ email }, "✅ Password-reset OTP email sent via SMTP");
}

export async function sendSupportContactEmail(params: {
  fromName: string;
  fromEmail: string;
  userType: string;
  message: string;
}): Promise<void> {
  const transporter   = getTransporter();
  const supportEmail  = process.env.SUPPORT_EMAIL?.trim() ?? process.env.SMTP_USER?.trim() ?? "support@mizu.app";

  if (!transporter) {
    logger.warn(
      { fromEmail: params.fromEmail },
      "⚠️  SMTP not configured — support message logged to console (dev mode only)"
    );
    console.log(
      `\n╔══════════════════════════════════════╗`,
      `\n║  [SUPPORT] من: ${params.fromName} (${params.fromEmail})`,
      `\n║  النوع: ${params.userType}`,
      `\n║  الرسالة: ${params.message}`,
      `\n╚══════════════════════════════════════╝\n`
    );
    return;
  }

  const html = `
    <div dir="rtl" style="font-family:sans-serif;max-width:600px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:16px;">
      <h2 style="color:#0ea5e9;margin-bottom:16px;">رسالة دعم جديدة — Mizu</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">الاسم</td><td style="padding:8px 0;font-weight:bold;color:#111827;">${params.fromName}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">البريد</td><td style="padding:8px 0;font-weight:bold;color:#111827;">${params.fromEmail}</td></tr>
        <tr><td style="padding:8px 0;color:#6b7280;font-size:14px;">نوع الحساب</td><td style="padding:8px 0;font-weight:bold;color:#111827;">${params.userType}</td></tr>
      </table>
      <div style="background:#f9fafb;border-right:4px solid #0ea5e9;padding:16px;border-radius:8px;">
        <p style="color:#374151;line-height:1.8;white-space:pre-wrap;">${params.message}</p>
      </div>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">أُرسلت هذه الرسالة من تطبيق Mizu لتوصيل المياه.</p>
    </div>`;

  await transporter.sendMail({
    from:    fromAddress(),
    to:      supportEmail,
    replyTo: params.fromEmail,
    subject: `[Mizu دعم] رسالة من ${params.fromName} — ${params.userType}`,
    html,
    text: `من: ${params.fromName} (${params.fromEmail})\nالنوع: ${params.userType}\n\n${params.message}`,
  });

  logger.info({ fromEmail: params.fromEmail, supportEmail }, "✅ Support contact email forwarded");
}

/**
 * sendAdminNewMessageNotification
 * Fired (soft-fail) whenever a driver submits a support thread message.
 * Destination: ADMIN_EMAIL → SUPPORT_EMAIL → SMTP_USER (first set wins).
 */
export async function sendAdminNewMessageNotification(params: {
  userName:  string;
  userPhone: string;
  userEmail: string | null;
  userType:  string;
  message:   string;
  sentAt:    Date;
}): Promise<void> {
  const transporter  = getTransporter();
  const adminEmail   =
    process.env.ADMIN_EMAIL?.trim()   ??
    process.env.SUPPORT_EMAIL?.trim() ??
    process.env.SMTP_USER?.trim()     ??
    "admin@mizu.app";

  const dateStr = params.sentAt.toLocaleString("ar-DZ", { timeZone: "Africa/Algiers" });

  if (!transporter) {
    logger.warn(
      { userName: params.userName },
      "⚠️  SMTP not configured — admin support notification logged to console"
    );
    console.log(
      `\n╔══════════════════════════════════════╗`,
      `\n║  [SUPPORT ALERT] من: ${params.userName} (${params.userPhone})`,
      `\n║  النوع: ${params.userType}`,
      `\n║  الرسالة: ${params.message}`,
      `\n║  التاريخ: ${dateStr}`,
      `\n╚══════════════════════════════════════╝\n`
    );
    return;
  }

  const html = `
    <div dir="rtl" style="font-family:sans-serif;max-width:620px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:16px;">
      <h2 style="color:#0ea5e9;margin-bottom:4px;">📩 رسالة جديدة من خدمة العملاء</h2>
      <p style="color:#6b7280;font-size:13px;margin-top:0;">تطبيق طلباتي — Talabati</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr style="background:#f9fafb;">
          <td style="padding:10px 12px;color:#6b7280;font-size:14px;border-radius:4px;">الاسم</td>
          <td style="padding:10px 12px;font-weight:bold;color:#111827;">${params.userName}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;color:#6b7280;font-size:14px;">الهاتف</td>
          <td style="padding:10px 12px;font-weight:bold;color:#111827;">${params.userPhone}</td>
        </tr>
        ${params.userEmail ? `<tr style="background:#f9fafb;"><td style="padding:10px 12px;color:#6b7280;font-size:14px;">البريد</td><td style="padding:10px 12px;font-weight:bold;color:#111827;">${params.userEmail}</td></tr>` : ""}
        <tr${params.userEmail ? "" : ' style="background:#f9fafb;"'}>
          <td style="padding:10px 12px;color:#6b7280;font-size:14px;">نوع الحساب</td>
          <td style="padding:10px 12px;font-weight:bold;color:#111827;">${params.userType}</td>
        </tr>
        <tr style="background:#f9fafb;">
          <td style="padding:10px 12px;color:#6b7280;font-size:14px;">التاريخ</td>
          <td style="padding:10px 12px;font-weight:bold;color:#111827;">${dateStr}</td>
        </tr>
      </table>
      <div style="background:#f0f9ff;border-right:4px solid #0ea5e9;padding:16px 20px;border-radius:8px;margin-bottom:20px;">
        <p style="color:#0f172a;line-height:1.9;margin:0;white-space:pre-wrap;">${params.message}</p>
      </div>
      <p style="color:#9ca3af;font-size:12px;">يمكنك الرد من لوحة الأدمن. لا تردّ مباشرةً على هذا البريد.</p>
    </div>`;

  await transporter.sendMail({
    from:    fromAddress(),
    to:      adminEmail,
    subject: `[طلباتي دعم] رسالة جديدة من ${params.userName} — ${params.userType}`,
    html,
    text: `رسالة جديدة من: ${params.userName} (${params.userPhone})\nالنوع: ${params.userType}\nالتاريخ: ${dateStr}\n\n${params.message}\n\n-- يمكنك الرد من لوحة الأدمن --`,
  });

  logger.info({ userName: params.userName, adminEmail }, "✅ Admin notified of new support message");
}
