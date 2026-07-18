import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  try {
    const payload = await req.json();
    const record = payload.record;

    if (!record) {
      return new Response(JSON.stringify({ error: "no record in payload" }), { status: 400 });
    }

    // Only notify for user messages — skip admin replies
    if (record.sender_type === "admin") {
      return new Response(JSON.stringify({ skipped: "admin message" }), { status: 200 });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const ADMIN_EMAIL    = Deno.env.get("ADMIN_EMAIL");

    if (!RESEND_API_KEY || !ADMIN_EMAIL) {
      console.error("Missing RESEND_API_KEY or ADMIN_EMAIL env vars");
      return new Response(JSON.stringify({ error: "missing env vars" }), { status: 500 });
    }

    const userId  = record.user_id  ?? "زائر غير مسجّل";
    const message = record.message  ?? "(فارغة)";
    const sentAt  = record.created_at
      ? new Date(record.created_at).toLocaleString("ar-DZ", { timeZone: "Africa/Algiers" })
      : new Date().toLocaleString("ar-DZ", { timeZone: "Africa/Algiers" });

    const html = `
      <div dir="rtl" style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:16px;">
        <h2 style="color:#0ea5e9;margin-bottom:4px;">📩 رسالة جديدة من خدمة العملاء</h2>
        <p style="color:#6b7280;font-size:13px;margin-top:0;">تطبيق طلباتي — Talabati</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;">
          <tr style="background:#f9fafb;">
            <td style="padding:10px 12px;color:#6b7280;font-size:14px;">المستخدم</td>
            <td style="padding:10px 12px;font-weight:bold;color:#111827;">${userId}</td>
          </tr>
          <tr>
            <td style="padding:10px 12px;color:#6b7280;font-size:14px;">التاريخ</td>
            <td style="padding:10px 12px;font-weight:bold;color:#111827;">${sentAt}</td>
          </tr>
        </table>
        <div style="background:#f0f9ff;border-right:4px solid #0ea5e9;padding:16px 20px;border-radius:8px;margin-bottom:20px;">
          <p style="color:#0f172a;line-height:1.9;margin:0;white-space:pre-wrap;">${message}</p>
        </div>
        <p style="color:#9ca3af;font-size:12px;">يمكنك الرد من لوحة الأدمن. لا تردّ مباشرةً على هذا البريد.</p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:    "Talabati Support <onboarding@resend.dev>",
        to:      ADMIN_EMAIL,
        subject: `[طلباتي دعم] رسالة جديدة من المستخدم ${userId}`,
        html,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("Resend API error:", data);
      return new Response(JSON.stringify({ ok: false, error: data }), { status: 500 });
    }

    console.log("✅ Support notification sent:", data);
    return new Response(JSON.stringify({ ok: true, id: data.id }), { status: 200 });

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
