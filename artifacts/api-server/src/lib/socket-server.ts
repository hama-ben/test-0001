/**
 * Socket.io real-time server.
 *
 * Security model:
 *  - Every connection is authenticated at handshake time via io.use() middleware.
 *    The client passes { auth: { sessionToken } } in the Socket.io handshake
 *    where sessionToken is the Supabase JWT access token.
 *  - The token is verified cryptographically via supabase.auth.getUser(token),
 *    which validates JWT signature, issuer, audience, and expiry server-side.
 *    No local base64 decoding is used — forged tokens are rejected.
 *  - After authentication, socket.data.userId and socket.data.userType are set
 *    from the verified Supabase user object, NOT from any client-supplied payload.
 *
 * Room layout:
 *  - "user:<userId>"  — targeted consumer/driver events (order status changes).
 *  - "drivers"        — broadcast room for new-order events to all active drivers.
 */

import { Server as SocketIOServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "http";
import { eq } from "drizzle-orm";
import { db, driverDetailsTable } from "@workspace/db";
import { getSupabaseAuth } from "./supabase-server";
import { logger } from "./logger";

/**
 * Build the region-scoped room name for a wilaya+commune pair.
 * Drivers only join the room for their own commune, so a new-order broadcast
 * reaches only the drivers who could actually serve it — not every connected
 * driver nationwide. This matters a lot at scale: with hundreds of drivers
 * connected across the country, broadcasting every order to everyone turns
 * one order into hundreds of irrelevant client re-fetches.
 */
function regionRoom(wilaya: string, commune: string): string {
  return `drivers:${wilaya}:${commune}`;
}

let io: SocketIOServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: true,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
    allowEIO3: true,
  });

  // ── Handshake authentication middleware ───────────────────────────────────
  // Runs before any event handler. Rejects unauthenticated connections.
  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.sessionToken as string | undefined;

    if (!token) {
      logger.warn({ socketId: socket.id }, "Socket rejected: no sessionToken in handshake");
      return next(new Error("UNAUTHORIZED"));
    }

    const supabase = getSupabaseAuth();
    if (!supabase) {
      logger.error("Socket auth: Supabase client unavailable — rejecting all connections");
      return next(new Error("SERVICE_UNAVAILABLE"));
    }

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      logger.warn({ socketId: socket.id, err: error?.message }, "Socket rejected: invalid or expired JWT");
      return next(new Error("UNAUTHORIZED"));
    }

    const userType =
      (user.app_metadata as Record<string, unknown>)?.userType as string ??
      (user.user_metadata as Record<string, unknown>)?.userType as string ??
      "";

    socket.data.userId   = user.id;
    socket.data.userType = userType;

    next();
  });

  io.on("connection", (socket: Socket) => {
    const { userId, userType } = socket.data as { userId: string; userType: string };
    logger.info({ socketId: socket.id, userId }, "Socket authenticated and connected");

    socket.on("register", () => {
      socket.join(`user:${userId}`);
      logger.info({ socketId: socket.id, userId }, "Socket: joined user room");
    });

    socket.on("register_driver", async () => {
      // Always join the legacy global "drivers" room too — cheap, and it's
      // the fallback target for a driver whose wilaya/commune isn't set yet
      // (matches the existing server-side guard: orders.ts only emits when
      // the order's own wilaya+commune are present).
      socket.join("drivers");

      try {
        const [details] = await db
          .select({ wilaya: driverDetailsTable.wilaya, commune: driverDetailsTable.commune })
          .from(driverDetailsTable)
          .where(eq(driverDetailsTable.driverId, userId));

        if (details?.wilaya && details?.commune) {
          const room = regionRoom(details.wilaya, details.commune);
          socket.join(room);
          logger.info({ socketId: socket.id, userId, room }, "Socket: joined region drivers room");
        } else {
          logger.info({ socketId: socket.id, userId }, "Socket: no region on file — joined global drivers room only");
        }
      } catch (err) {
        logger.warn({ err, socketId: socket.id, userId }, "Socket: region lookup failed — joined global drivers room only");
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info({ socketId: socket.id, userId, reason }, "Socket disconnected");
    });
  });

  logger.info("Socket.io server initialised (with Supabase JWT authentication)");
  return io;
}

/** Broadcast an event to ALL connected drivers nationwide. Use sparingly —
 *  prefer emitToDriversInRegion for anything order-related. */
export function emitToDrivers(event: string, data: unknown): void {
  if (!io) return;
  io.to("drivers").emit(event, data);
}

/**
 * Emit an event only to drivers whose registered wilaya+commune matches.
 * This is what keeps a nationwide fleet from being spammed by every order
 * placed anywhere in the country — each new order only wakes up the drivers
 * who could actually take it.
 */
export function emitToDriversInRegion(
  wilaya: string,
  commune: string,
  event: string,
  data: unknown
): void {
  if (!io) return;
  io.to(regionRoom(wilaya, commune)).emit(event, data);
}

/** Send an event to a specific consumer/driver by their persistent userId. */
export function emitToUser(userId: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

export function getIO(): SocketIOServer | null {
  return io;
}
