import { Router, type IRouter } from "express";
import { eq, desc, count, sql, and, gte, lt } from "drizzle-orm";
import { db, ordersTable, usersTable, driverDetailsTable, driverStatusTable } from "@workspace/db";
import {
  CreateOrderBody,
  GetUserOrdersParams,
  UpdateOrderStatusParams,
  UpdateOrderStatusBody,
  GetActiveOrdersResponse,
  GetOrdersSummaryResponse,
} from "@workspace/api-zod";
import { broadcastNewOrder, broadcastOrderClaimed, broadcastOrderStatusChange } from "../lib/supabase-server";
import { emitToDrivers, emitToDriversInRegion, emitToUser } from "../lib/socket-server";
import { sendPushToUser } from "../lib/web-push";

const router: IRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Daily order limit helpers
// Algeria is UTC+1 year-round (Africa/Algiers, no DST).
// ─────────────────────────────────────────────────────────────────────────────
const DAILY_ORDER_LIMIT  = 3;
const ALGERIA_OFFSET_MS  = 60 * 60 * 1000; // UTC+1

function algeriaDateBoundaries(): { start: Date; end: Date; resetsAt: string } {
  const nowUtcMs       = Date.now();
  const nowAlgeriaMs   = nowUtcMs + ALGERIA_OFFSET_MS;
  const dayMs          = 24 * 60 * 60 * 1000;
  const startAlgeriaMs = nowAlgeriaMs - (nowAlgeriaMs % dayMs);

  const start    = new Date(startAlgeriaMs - ALGERIA_OFFSET_MS);      // UTC
  const end      = new Date(startAlgeriaMs + dayMs - ALGERIA_OFFSET_MS); // UTC
  const resetsAt = end.toISOString();

  return { start, end, resetsAt };
}

function mapOrder(o: {
  id: string;
  userId: string;
  driverId: string | null;
  userName: string | null;
  userPhone: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  waterVolume: string;
  barrelCount: number;
  totalPrice: string;
  latitude: string | null;
  longitude: string | null;
  status: string;
  createdAt: Date;
}) {
  return {
    id: o.id,
    userId: o.userId,
    driverId: o.driverId ?? null,
    userName: o.userName ?? null,
    userPhone: o.userPhone ?? null,
    driverName: o.driverName ?? null,
    driverPhone: o.driverPhone ?? null,
    waterVolume: o.waterVolume,
    barrelCount: o.barrelCount,
    totalPrice: Number(o.totalPrice),
    latitude: o.latitude !== null ? Number(o.latitude) : null,
    longitude: o.longitude !== null ? Number(o.longitude) : null,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
  };
}

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { waterVolume, barrelCount, totalPrice, latitude, longitude } = parsed.data;
  // Always use the authenticated user's ID — never trust client-supplied userId
  const userId = req.auth!.userId;

  // ── Daily order limit — customers only, drivers are not restricted ───────────
  if (req.auth?.userType === "مستهلك") {
    try {
      const { start, end } = algeriaDateBoundaries();
      const [{ value: todayCount }] = await db
        .select({ value: count() })
        .from(ordersTable)
        .where(and(
          eq(ordersTable.userId, userId),
          gte(ordersTable.createdAt, start),
          lt(ordersTable.createdAt, end),
        ));

      if (todayCount >= DAILY_ORDER_LIMIT) {
        req.log.warn({ userId, todayCount }, "Daily order limit exceeded");
        res.status(429).json({
          error: "لقد استنفدت الحد الأقصى لطلبات اليوم (3 طلبات). يمكنك تقديم طلبات جديدة بعد منتصف الليل.",
          code:  "DAILY_ORDER_LIMIT_EXCEEDED",
        });
        return;
      }
    } catch (err) {
      req.log.warn({ err }, "Daily limit check failed — allowing order anyway");
    }
  }

  try {
    const [order] = await db
      .insert(ordersTable)
      .values({
        userId,
        waterVolume,
        barrelCount,
        totalPrice: String(totalPrice),
        status: "معلق",
        latitude: latitude !== undefined && latitude !== null ? String(latitude) : null,
        longitude: longitude !== undefined && longitude !== null ? String(longitude) : null,
      })
      .returning();

    const [user] = await db
      .select({
        name: usersTable.name,
        phone: usersTable.phone,
        commune: usersTable.commune,
        wilaya: usersTable.wilaya,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    req.log.info({ orderId: order.id }, "Order created");

    res.status(201).json(mapOrder({
      ...order,
      userName: user?.name ?? null,
      userPhone: user?.phone ?? null,
    }));

    const orderPayload = {
      orderId: order.id,
      commune: user?.commune ?? "",
      wilaya: user?.wilaya ?? "",
      waterVolume,
      barrelCount,
    };

    // ── Socket.io: emit only to drivers in this order's own wilaya/commune ──
    // (primary real-time layer). Broadcasting nationwide here would turn one
    // order into one client re-fetch per connected driver in the whole
    // country — a real bottleneck against the DB pool at fleet scale.
    if (user?.commune && user?.wilaya) {
      emitToDriversInRegion(user.wilaya, user.commune, "new_order", orderPayload);
    }

    // ── Supabase Realtime: secondary broadcast for drivers not on Socket.io ──
    if (user?.commune && user?.wilaya) {
      broadcastNewOrder(orderPayload).catch(() => {});
    }

    // ── Web Push: alert drivers whose browser/tab is closed ──────────────────
    // Look up all APPROVED, non-"مغلق" drivers in the same wilaya+commune and
    // push to each one. Drivers who set themselves to "مغلق" must receive
    // absolutely no notification, and unapproved accounts shouldn't either.
    if (user?.commune && user?.wilaya) {
      db.select({ id: driverDetailsTable.driverId })
        .from(driverDetailsTable)
        .innerJoin(usersTable, eq(usersTable.id, driverDetailsTable.driverId))
        .leftJoin(driverStatusTable, eq(driverStatusTable.driverId, driverDetailsTable.driverId))
        .where(
          and(
            eq(driverDetailsTable.wilaya,  user.wilaya),
            eq(driverDetailsTable.commune, user.commune),
            eq(usersTable.accountStatus, "approved"),
            sql`COALESCE(${driverStatusTable.currentStatus}, 'مغلق') <> 'مغلق'`,
          )
        )
        .then((drivers) => {
          const pushPayload = {
            title: "طلب جديد في منطقتك! 🔔",
            body:  `${waterVolume} — اضغط لعرض الطلبات`,
            url:   "/driver-dashboard",
          };
          for (const { id } of drivers) {
            sendPushToUser(id, pushPayload).catch(() => {});
          }
        })
        .catch(() => {});
    }

    // ─── Feature 7: 5-minute timeout — auto-re-open if no driver accepts ──────
    setTimeout(async () => {
      try {
        const [check] = await db
          .select({ status: ordersTable.status })
          .from(ordersTable)
          .where(eq(ordersTable.id, order.id));
        if (check?.status === "معلق") {
          if (user?.commune && user?.wilaya) {
            emitToDriversInRegion(user.wilaya, user.commune, "new_order", orderPayload);
            await broadcastNewOrder(orderPayload);
          }
        }
      } catch { /* ignore */ }
    }, 5 * 60 * 1000);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "خطأ في الخادم";
    res.status(400).json({ error: message });
  }
});

// GET /orders/today-count — daily order counter for the authenticated customer
router.get("/orders/today-count", async (req, res): Promise<void> => {
  const userId = req.auth!.userId;
  const { start, end, resetsAt } = algeriaDateBoundaries();

  try {
    const [{ value: used }] = await db
      .select({ value: count() })
      .from(ordersTable)
      .where(and(
        eq(ordersTable.userId, userId),
        gte(ordersTable.createdAt, start),
        lt(ordersTable.createdAt, end),
      ));

    res.json({
      used,
      remaining: Math.max(0, DAILY_ORDER_LIMIT - used),
      limit:     DAILY_ORDER_LIMIT,
      resetsAt,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "خطأ في الخادم";
    res.status(500).json({ error: message });
  }
});

// IMPORTANT: /active, /summary, and /status-poll must come BEFORE /:userId
router.get("/orders/active", async (req, res): Promise<void> => {
  // SECURITY: never trust a client-supplied driverId. Only the authenticated
  // driver's own orders-in-area may be returned.
  if (req.auth?.userType !== "سائق") {
    res.status(403).json({ error: "هذه النقطة مخصصة للسائقين فقط" });
    return;
  }
  const driverId = req.auth.userId;

  const [driverDetails] = await db
    .select({ wilaya: driverDetailsTable.wilaya, commune: driverDetailsTable.commune })
    .from(driverDetailsTable)
    .where(eq(driverDetailsTable.driverId, driverId));

  // SECURITY / CORRECTNESS: if this driver has no wilaya/commune on file yet,
  // return an empty list — NEVER fall back to showing every pending order
  // nationwide. Geographic isolation between communes must hold with no
  // exceptions.
  if (!driverDetails?.wilaya || !driverDetails?.commune) {
    res.json(GetActiveOrdersResponse.parse([]));
    return;
  }

  const consumerUsers = usersTable;
  const orders = await db
    .select({
      id: ordersTable.id,
      userId: ordersTable.userId,
      driverId: ordersTable.driverId,
      userName: consumerUsers.name,
      userPhone: consumerUsers.phone,
      waterVolume: ordersTable.waterVolume,
      barrelCount: ordersTable.barrelCount,
      totalPrice: ordersTable.totalPrice,
      latitude: ordersTable.latitude,
      longitude: ordersTable.longitude,
      status: ordersTable.status,
      createdAt: ordersTable.createdAt,
    })
    .from(ordersTable)
    .leftJoin(consumerUsers, eq(ordersTable.userId, consumerUsers.id))
    .where(
      and(
        eq(ordersTable.status, "معلق"),
        eq(consumerUsers.wilaya, driverDetails.wilaya),
        eq(consumerUsers.commune, driverDetails.commune)
      )
    )
    .orderBy(desc(ordersTable.createdAt));

  res.json(GetActiveOrdersResponse.parse(orders.map(mapOrder)));
});

router.get("/orders/summary", async (req, res): Promise<void> => {
  const { userId, userType } = req.auth!;
  const isDriver = userType === "سائق";

  const [totals] = await db
    .select({
      total: count(ordersTable.id),
      totalRevenue: sql<number>`COALESCE(SUM(${ordersTable.totalPrice}), 0)`,
    })
    .from(ordersTable)
    .where(isDriver ? eq(ordersTable.driverId, userId) : undefined);

  const [pending] = await db
    .select({ cnt: count(ordersTable.id) })
    .from(ordersTable)
    .where(
      isDriver
        ? and(eq(ordersTable.driverId, userId), eq(ordersTable.status, "معلق"))
        : eq(ordersTable.status, "معلق")
    );

  const [inDelivery] = await db
    .select({ cnt: count(ordersTable.id) })
    .from(ordersTable)
    .where(
      isDriver
        ? and(eq(ordersTable.driverId, userId), eq(ordersTable.status, "قيد التوصيل"))
        : eq(ordersTable.status, "قيد التوصيل")
    );

  const [delivered] = await db
    .select({ cnt: count(ordersTable.id) })
    .from(ordersTable)
    .where(
      isDriver
        ? and(eq(ordersTable.driverId, userId), eq(ordersTable.status, "تم التوصيل"))
        : eq(ordersTable.status, "تم التوصيل")
    );

  res.json(
    GetOrdersSummaryResponse.parse({
      total: totals?.total ?? 0,
      pending: pending?.cnt ?? 0,
      inDelivery: inDelivery?.cnt ?? 0,
      delivered: delivered?.cnt ?? 0,
      totalRevenue: Number(totals?.totalRevenue ?? 0),
    })
  );
});

/**
 * Polling fallback endpoint.
 * Clients call this every few seconds when the WebSocket connection drops
 * so they can still detect order status changes without a live socket.
 * GET /api/orders/:orderId/status
 */
router.get("/orders/:orderId/status", async (req, res): Promise<void> => {
  const orderId = Array.isArray(req.params.orderId)
    ? req.params.orderId[0]
    : req.params.orderId;

  const [order] = await db
    .select({
      id: ordersTable.id,
      status: ordersTable.status,
      driverId: ordersTable.driverId,
    })
    .from(ordersTable)
    .where(eq(ordersTable.id, orderId));

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  res.json({ id: order.id, status: order.status, driverId: order.driverId ?? null });
});

// ─── Cancel order (consumer only) ────────────────────────────────────────────
router.delete("/orders/:orderId", async (req, res): Promise<void> => {
  const orderId = Array.isArray(req.params.orderId)
    ? req.params.orderId[0]
    : req.params.orderId;

  // SECURITY: a consumer may only cancel their own order — never someone
  // else's, no matter how the orderId was obtained.
  const [order] = await db
    .update(ordersTable)
    .set({ status: "ملغى" })
    .where(
      and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.status, "معلق"),
        eq(ordersTable.userId, req.auth!.userId),
      )
    )
    .returning();

  if (!order) {
    res.status(409).json({ error: "لا يمكن إلغاء هذا الطلب — قد يكون قيد التوصيل بالفعل" });
    return;
  }

  req.log.info({ orderId }, "Order cancelled by consumer");

  // Notify drivers the order is gone
  emitToDrivers("order_claimed", { orderId });
  broadcastOrderClaimed(orderId);

  // Notify the consumer
  emitToUser(order.userId, "order_status_changed", { orderId, status: "ملغى", driverId: null });

  res.json({ success: true, orderId });
});

router.get("/orders/:userId", async (req, res): Promise<void> => {
  // Enforce ownership: authenticated user can only fetch their own orders.
  // Ignore the :userId path param and use the verified auth identity instead.
  const userId = req.auth!.userId;

  const driverUsers = db
    .select({ id: usersTable.id, name: usersTable.name, phone: usersTable.phone })
    .from(usersTable)
    .as("driver_users");

  const orders = await db
    .select({
      id: ordersTable.id,
      userId: ordersTable.userId,
      driverId: ordersTable.driverId,
      userName: usersTable.name,
      userPhone: usersTable.phone,
      driverName: driverUsers.name,
      driverPhone: driverUsers.phone,
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
    .leftJoin(driverUsers, eq(ordersTable.driverId, driverUsers.id))
    .where(eq(ordersTable.userId, userId))
    .orderBy(desc(ordersTable.createdAt));

  res.json(orders.map(mapOrder));
});

router.patch("/orders/:orderId/status", async (req, res): Promise<void> => {
  const params = UpdateOrderStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateOrderStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.data });
    return;
  }

  // SECURITY: only the driver actually assigned to this order may change its
  // status — never trust that the caller is who they claim just because
  // they're authenticated. A consumer, or an unrelated driver, must not be
  // able to mark someone else's order as delivered.
  const [existingOrder] = await db
    .select({ driverId: ordersTable.driverId })
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.orderId));

  if (!existingOrder) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }
  if (req.auth?.userType !== "سائق" || existingOrder.driverId !== req.auth.userId) {
    res.status(403).json({ error: "غير مصرح لك بتعديل حالة هذه الطلبية" });
    return;
  }

  const [order] = await db
    .update(ordersTable)
    .set({ status: body.data.status })
    .where(eq(ordersTable.id, params.data.orderId))
    .returning();

  if (!order) {
    res.status(404).json({ error: "الطلب غير موجود" });
    return;
  }

  const [user] = await db
    .select({ name: usersTable.name, phone: usersTable.phone })
    .from(usersTable)
    .where(eq(usersTable.id, order.userId));

  const result = mapOrder({
    ...order,
    userName: user?.name ?? null,
    userPhone: user?.phone ?? null,
  });

  res.json(result);

  // ── Socket.io: notify the specific consumer (primary) ──
  emitToUser(order.userId, "order_status_changed", {
    orderId: order.id,
    status: order.status,
    driverId: order.driverId ?? null,
  });

  // ── Supabase Realtime: secondary broadcast ──
  broadcastOrderStatusChange({ orderId: order.id, status: order.status, driverId: order.driverId }).catch(() => {});
});

// Atomic accept — prevents two drivers picking the same order
router.post("/orders/:orderId/accept", async (req, res): Promise<void> => {
  const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;

  // SECURITY: never trust a client-supplied driverId — always use the
  // authenticated identity. Otherwise any account could accept an order
  // "as" a different driver.
  if (req.auth?.userType !== "سائق") {
    res.status(403).json({ error: "فقط السائقون يمكنهم قبول الطلبيات" });
    return;
  }
  const driverId = req.auth.userId;

  const [order] = await db
    .update(ordersTable)
    .set({ status: "قيد التوصيل", driverId })
    .where(
      and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.status, "معلق")
      )
    )
    .returning();

  if (!order) {
    res.status(409).json({ error: "الطلب تم قبوله من قِبل سائق آخر" });
    return;
  }

  const [user] = await db
    .select({ name: usersTable.name, phone: usersTable.phone })
    .from(usersTable)
    .where(eq(usersTable.id, order.userId));

  req.log.info({ orderId, driverId }, "Order accepted by driver");

  // ── Socket.io: tell all drivers this order is gone (primary) ──
  emitToDrivers("order_claimed", { orderId });

  // ── Socket.io: tell the specific consumer their order is accepted (primary) ──
  emitToUser(order.userId, "order_status_changed", {
    orderId,
    status: "قيد التوصيل",
    driverId,
  });

  // ── Supabase Realtime: secondary broadcast ──
  broadcastOrderClaimed(orderId);
  broadcastOrderStatusChange({ orderId, status: "قيد التوصيل", driverId }).catch(() => {});

  res.json(mapOrder({
    ...order,
    userName: user?.name ?? null,
    userPhone: user?.phone ?? null,
  }));
});

export default router;
