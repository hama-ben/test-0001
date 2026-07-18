import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, announcementReadsTable, usersTable } from "@workspace/db";
import { getSupabaseAdmin } from "../lib/supabase-server";

const router: IRouter = Router();

// Audience values the admin panel stores per user type.
// Admin uses English labels; also accept Arabic and legacy variants.
const DRIVER_AUDIENCES   = ["Everyone", "Drivers",   "all", "سائق",    "driver"];
const CUSTOMER_AUDIENCES = ["Everyone", "Customers", "Consumers", "all", "مستهلك", "customer"];

function audienceForType(userTypeKey: "driver" | "customer"): string[] {
  return userTypeKey === "driver" ? DRIVER_AUDIENCES : CUSTOMER_AUDIENCES;
}

router.get("/announcements", async (req, res): Promise<void> => {
  const authUserId   = req.auth?.userId;
  const authUserType = req.auth?.userType;
  const userTypeKey  = authUserType === "سائق" ? "driver" : "customer";

  const supa = getSupabaseAdmin();
  if (!supa) {
    res.json([]);
    return;
  }

  // Build the OR filter:
  //   a) Standard audience match (Everyone / Drivers / Customers / etc.)
  //   b) User-targeted announcement (target_audience = this user's ID)
  const audiences = audienceForType(userTypeKey).join(",");
  const orFilter  = authUserId
    ? `target_audience.in.(${audiences}),target_audience.eq.${authUserId}`
    : `target_audience.in.(${audiences})`;

  const { data: rows, error } = await supa
    .from("announcements")
    .select("id, title, content, target_audience, badge_text, is_active, created_at")
    .eq("is_active", true)
    .or(orFilter)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    req.log.error({ err: error.message }, "Failed to fetch announcements from Supabase");
    res.json([]);
    return;
  }

  // Fetch the user's registration date to filter old announcements.
  // Null means existing user (pre-feature) — they see everything.
  let userCreatedAt: Date | null = null;
  if (authUserId) {
    try {
      const [userRow] = await db
        .select({ createdAt: usersTable.createdAt })
        .from(usersTable)
        .where(eq(usersTable.id, authUserId))
        .limit(1);
      userCreatedAt = userRow?.createdAt ?? null;
    } catch {
      // silently ignore
    }
  }

  // Which of these has this user already read/dismissed? (tracked in local DB)
  const readIds = new Set<string>();
  if (authUserId) {
    try {
      const reads = await db
        .select({ announcementId: announcementReadsTable.announcementId })
        .from(announcementReadsTable)
        .where(
          and(
            eq(announcementReadsTable.userId, authUserId),
            eq(announcementReadsTable.userType, userTypeKey)
          )
        );
      reads.forEach(r => readIds.add(r.announcementId));
    } catch {
      // table may not exist yet on first boot — silently ignore
    }
  }

  // Apply registration-date filter in JS for flexibility:
  //   - Announcements targeted directly at this user → always visible
  //   - If no registration date (existing/legacy user) → show all
  //   - Otherwise → only show announcements created after the user registered
  const filtered = (rows ?? []).filter(r => {
    if (r.target_audience === authUserId) return true;
    if (!userCreatedAt) return true;
    return new Date(r.created_at) > userCreatedAt;
  });

  // Dismissed announcements are tracked in announcement_reads —
  // exclude them entirely from the response so they stay gone after refresh.
  const visible = filtered.filter(r => !readIds.has(r.id));

  res.setHeader("Cache-Control", "no-cache");

  res.json(
    visible.map(r => ({
      id:             r.id,
      title:          r.title,
      content:        r.content,
      targetAudience: r.target_audience,
      badgeText:      r.badge_text ?? null,
      createdAt:      r.created_at,
      isRead:         false,
    }))
  );
});

router.post("/announcements/mark-read", async (req, res): Promise<void> => {
  const { announcementIds, userType } = req.body as {
    announcementIds?: string[];
    userType?: string;
  };
  const userId = req.auth?.userId;

  if (!userId || !Array.isArray(announcementIds) || announcementIds.length === 0 || !userType) {
    res.status(400).json({ error: "بيانات ناقصة" });
    return;
  }

  const userTypeKey = userType === "driver" ? "driver" : "customer";

  await db
    .insert(announcementReadsTable)
    .values(announcementIds.map(id => ({
      announcementId: id,
      userId,
      userType: userTypeKey,
    })))
    .onConflictDoNothing();

  res.json({ marked: announcementIds.length });
});

export default router;
