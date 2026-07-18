import { Router, type IRouter } from "express";
import { eq, avg, sql } from "drizzle-orm";
import { db, ratingsTable, ordersTable } from "@workspace/db";

const router: IRouter = Router();

router.post("/orders/:orderId/rate", async (req, res): Promise<void> => {
  const { orderId } = req.params;
  // SECURITY: never trust raterUserId/raterType from the request body —
  // derive them from the authenticated session instead, otherwise anyone
  // could submit a rating pretending to be a different user.
  const raterUserId = req.auth!.userId;
  const raterType = req.auth!.userType === "سائق" ? "driver" : "consumer";
  const { ratedUserId, stars, comment } = req.body as {
    ratedUserId?: string; stars?: number; comment?: string;
  };

  if (!ratedUserId || stars == null) {
    res.status(400).json({ error: "جميع الحقول مطلوبة" });
    return;
  }
  if (stars < 1 || stars > 5) {
    res.status(400).json({ error: "التقييم يجب أن يكون بين 1 و 5 نجوم" });
    return;
  }

  // The order must exist, be fully delivered, and the rater/rated pair must
  // actually be the two real parties on that order — not arbitrary IDs.
  const [order] = await db
    .select({ userId: ordersTable.userId, driverId: ordersTable.driverId, status: ordersTable.status })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }
  if (order.status !== "تم التوصيل") {
    res.status(409).json({ error: "لا يمكن التقييم قبل اكتمال التوصيل" });
    return;
  }

  const isConsumerRatingDriver = raterType === "consumer" && order.userId === raterUserId && order.driverId === ratedUserId;
  const isDriverRatingConsumer = raterType === "driver"   && order.driverId === raterUserId && order.userId === ratedUserId;
  if (!isConsumerRatingDriver && !isDriverRatingConsumer) {
    res.status(403).json({ error: "لا يمكنك تقييم هذه الطلبية" });
    return;
  }

  const [existing] = await db
    .select({ id: ratingsTable.id })
    .from(ratingsTable)
    .where(
      sql`${ratingsTable.orderId} = ${orderId} AND ${ratingsTable.raterUserId} = ${raterUserId}`
    );

  if (existing) {
    res.status(409).json({ error: "لقد قمت بالتقييم بالفعل لهذا الطلب" });
    return;
  }

  const [rating] = await db
    .insert(ratingsTable)
    .values({ orderId, raterUserId, ratedUserId, raterType, stars, comment: comment?.trim() || null })
    .returning();

  req.log.info({ orderId, raterType, stars }, "Rating submitted");
  res.status(201).json({ id: rating.id, stars: rating.stars });
});

router.post("/ratings/:ratingId/dispute", async (req, res): Promise<void> => {
  const { ratingId } = req.params;
  const { disputeReason } = req.body as { disputeReason?: string };

  if (!disputeReason?.trim()) {
    res.status(400).json({ error: "يرجى كتابة سبب الاعتراض" });
    return;
  }

  const [existing] = await db
    .select()
    .from(ratingsTable)
    .where(eq(ratingsTable.id, ratingId));

  if (!existing) {
    res.status(404).json({ error: "التقييم غير موجود" });
    return;
  }
  if (existing.disputeCount >= 1) {
    res.status(409).json({ error: "لقد قدّمت اعتراضاً من قبل على هذا التقييم" });
    return;
  }

  await db
    .update(ratingsTable)
    .set({ isDisputed: true, disputeReason, disputeCount: 1 })
    .where(eq(ratingsTable.id, ratingId));

  req.log.info({ ratingId }, "Rating disputed");
  res.json({ success: true });
});

router.get("/driver/:driverId/rating", async (req, res): Promise<void> => {
  const { driverId } = req.params;

  const result = await db
    .select({ avgStars: avg(ratingsTable.stars), total: sql<number>`count(*)::int` })
    .from(ratingsTable)
    .where(
      sql`${ratingsTable.ratedUserId} = ${driverId} AND ${ratingsTable.raterType} = 'consumer'`
    );

  const avgStars = result[0]?.avgStars ? parseFloat(result[0].avgStars) : null;
  const total = result[0]?.total ?? 0;

  res.json({ avgStars, total });
});

router.get("/orders/:orderId/rating", async (req, res): Promise<void> => {
  const { orderId } = req.params;
  const { raterUserId } = req.query as { raterUserId?: string };

  const rows = await db
    .select()
    .from(ratingsTable)
    .where(
      raterUserId
        ? sql`${ratingsTable.orderId} = ${orderId} AND ${ratingsTable.raterUserId} = ${raterUserId}`
        : sql`${ratingsTable.orderId} = ${orderId}`
    );

  res.json(
    rows.map((r) => ({
      id: r.id,
      orderId: r.orderId,
      raterUserId: r.raterUserId,
      ratedUserId: r.ratedUserId,
      raterType: r.raterType,
      stars: r.stars,
      isDisputed: r.isDisputed,
      disputeCount: r.disputeCount,
      createdAt: r.createdAt.toISOString(),
    }))
  );
});

export default router;
