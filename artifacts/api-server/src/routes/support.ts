import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { supportMessagesTable } from "@workspace/db";
import { sendSupportContactEmail, sendAdminNewMessageNotification } from "../lib/mailer";
import { eq, asc } from "drizzle-orm";

// ── PUBLIC router (no auth required) ─────────────────────────────────────────
const publicRouter: IRouter = Router();

// Anonymous support message from the login page
publicRouter.post("/support/message", async (req, res): Promise<void> => {
  const { message, userId } = req.body as { message?: string; userId?: string };

  if (!message?.trim() || message.trim().length < 3) {
    res.status(400).json({ error: "الرسالة قصيرة جداً" });
    return;
  }

  try {
    await db.insert(supportMessagesTable).values({
      userId:     userId?.trim() || null,
      message:    message.trim(),
      senderType: "user",
    });
    req.log.info({ userId: userId ?? "anonymous" }, "✅ Support message saved");

    // Soft-fail: notify admin without blocking the user response
    sendAdminNewMessageNotification({
      userName:  "زائر (غير مسجّل)",
      userPhone: userId ?? "—",
      userEmail: null,
      userType:  "مستخدم مجهول",
      message:   message.trim(),
      sentAt:    new Date(),
    }).catch((err) => req.log.warn({ err }, "Admin support notification failed (soft-fail)"));

    res.json({ message: "تم استلام رسالتك بنجاح" });
  } catch (err) {
    req.log.error({ err }, "support/message: DB insert failed");
    res.status(500).json({ error: "تعذّر حفظ الرسالة. يرجى المحاولة لاحقاً." });
  }
});

// Email-forwarded contact form (auth handled at caller level by email check only)
publicRouter.post("/support/contact", async (req, res): Promise<void> => {
  const { name, email, message, userType } = req.body as {
    name?: string; email?: string; message?: string; userType?: string;
  };

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    res.status(400).json({ error: "الاسم والبريد الإلكتروني والرسالة مطلوبة" });
    return;
  }

  if (message.trim().length < 10) {
    res.status(400).json({ error: "الرسالة قصيرة جداً، يرجى الإسهاب في الشرح" });
    return;
  }

  try {
    await sendSupportContactEmail({
      fromName:  name.trim(),
      fromEmail: email.trim(),
      userType:  userType?.trim() ?? "غير محدد",
      message:   message.trim(),
    });
    req.log.info({ email: email.trim(), userType }, "✅ Support contact message received");
    res.json({ message: "تم إرسال رسالتك بنجاح. سنرد عليك قريباً." });
  } catch (err) {
    req.log.error({ err }, "support/contact: failed to send email");
    res.status(500).json({ error: "تعذّر إرسال الرسالة. يرجى المحاولة لاحقاً." });
  }
});

// ── PROTECTED router (requires req.auth from requireAuth middleware) ───────────
const protectedRouter: IRouter = Router();

// GET /support/thread — fetch the full conversation for the logged-in user
protectedRouter.get("/support/thread", async (req, res): Promise<void> => {
  const userId = req.auth!.userId;

  try {
    const rows = await db
      .select()
      .from(supportMessagesTable)
      .where(eq(supportMessagesTable.userId, userId))
      .orderBy(asc(supportMessagesTable.createdAt));

    res.json({ messages: rows });
  } catch (err) {
    req.log.error({ err }, "support/thread: DB select failed");
    res.status(500).json({ error: "تعذّر جلب المحادثة" });
  }
});

// POST /support/thread/send — append a user message to the thread
protectedRouter.post("/support/thread/send", async (req, res): Promise<void> => {
  const userId = req.auth!.userId;
  const { message } = req.body as { message?: string };

  if (!message?.trim() || message.trim().length < 1) {
    res.status(400).json({ error: "الرسالة فارغة" });
    return;
  }

  try {
    const [row] = await db
      .insert(supportMessagesTable)
      .values({
        userId,
        message:    message.trim(),
        senderType: "user",
        status:     "pending",
      })
      .returning();

    req.log.info({ userId }, "✅ User sent support thread message");

    // Soft-fail: fetch sender info then notify admin — does NOT affect user response
    db.select({
      name:     usersTable.name,
      phone:    usersTable.phone,
      email:    usersTable.email,
      userType: usersTable.userType,
    })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .then(([user]) => {
        const userName  = user?.name  ?? "مستخدم";
        const userPhone = user?.phone ?? "—";
        const userEmail = user?.email ?? null;
        const userType  = user?.userType === "driver" ? "سائق" : "مستهلك";

        return sendAdminNewMessageNotification({
          userName,
          userPhone,
          userEmail,
          userType,
          message: message.trim(),
          sentAt:  new Date(),
        });
      })
      .catch((err) => req.log.warn({ err, userId }, "Admin support notification failed (soft-fail)"));

    res.json({ message: row });
  } catch (err) {
    req.log.error({ err }, "support/thread/send: DB insert failed");
    res.status(500).json({ error: "تعذّر إرسال الرسالة" });
  }
});

export { publicRouter as supportPublicRouter, protectedRouter as supportProtectedRouter };
export default publicRouter;
