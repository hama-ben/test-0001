/**
 * Server-side Supabase singletons.
 *
 * Provides:
 *  - getSupabaseAuth()         — anon-key client for Auth operations (signUp, signIn, verifyOtp, getUser)
 *  - getSupabaseAdmin()        — service-role admin client (storage + auth.admin.*)
 *  - getSupabaseServer()       — alias kept for Realtime broadcast channel
 *  - initRealtimeBroadcast()   — connects a persistent Realtime channel at startup
 *  - broadcastNewOrder()       — fire-and-forget broadcast to that channel
 */

import { createClient, type SupabaseClient, type RealtimeChannel } from "@supabase/supabase-js";
import { logger } from "./logger";

export const ORDERS_CHANNEL       = "orders:new";
export const EVENT_NEW_ORDER      = "new_order";
export const EVENT_ORDER_CLAIMED  = "order_claimed";
export const EVENT_STATUS_CHANGED = "order_status_changed";

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseUrl(raw: string): string {
  return raw
    .replace(/\/(rest|auth|storage|realtime|functions)(\/.*)?$/, "")
    .replace(/\/$/, "");
}

// ── Auth client (anon key) ────────────────────────────────────────────────────
// Used for: signUp, signInWithPassword, signInWithOtp, verifyOtp, getUser
// The anon key is safe to use on the server; it does NOT bypass RLS.

let _authClient: SupabaseClient | null = null;

export function getSupabaseAuth(): SupabaseClient | null {
  if (_authClient) return _authClient;

  const rawUrl = process.env.SUPABASE_URL?.trim();
  const key    = process.env.SUPABASE_ANON_KEY?.trim();

  if (!rawUrl || !key) {
    logger.warn("supabase-server: SUPABASE_URL or SUPABASE_ANON_KEY not set — Auth operations unavailable");
    return null;
  }

  _authClient = createClient(normaliseUrl(rawUrl), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return _authClient;
}

// ── Storage / admin client (service-role key ONLY) ────────────────────────────
// Used for: storage uploads, supabase.auth.admin.* operations (update password, set app_metadata)
// Never falls back to anon key — admin operations MUST use service role.

let _adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (_adminClient) return _adminClient;

  const rawUrl = process.env.SUPABASE_URL?.trim();
  const key    = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!rawUrl || !key) {
    logger.warn(
      "supabase-server: SUPABASE_SERVICE_ROLE_KEY not set — " +
      "storage uploads and admin auth operations will be unavailable until it is configured"
    );
    return null;
  }

  _adminClient = createClient(normaliseUrl(rawUrl), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return _adminClient;
}

// ── Broadcast/realtime client (anon key) ──────────────────────────────────────
// Alias kept for Realtime channel subscriptions; falls back to service-role key.

let _realtimeClient: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient | null {
  if (_realtimeClient) return _realtimeClient;

  const rawUrl = process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_ANON_KEY?.trim();

  if (!rawUrl || !key) {
    logger.warn("supabase-server: SUPABASE_URL or key not set — Realtime disabled");
    return null;
  }

  _realtimeClient = createClient(normaliseUrl(rawUrl), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return _realtimeClient;
}

// ── Persistent broadcast channel ──────────────────────────────────────────────

let _channel: RealtimeChannel | null = null;
let _channelReady = false;

export function initRealtimeBroadcast(): void {
  const client = getSupabaseServer();
  if (!client) return;

  _channel = client.channel(ORDERS_CHANNEL, {
    config: { broadcast: { self: false, ack: false } },
  });

  _channel.subscribe((status, err) => {
    if (status === "SUBSCRIBED") {
      _channelReady = true;
      logger.info({ channel: ORDERS_CHANNEL }, "✅ Realtime broadcast channel ready");
    } else if (status === "CHANNEL_ERROR") {
      _channelReady = false;
      logger.warn({ channel: ORDERS_CHANNEL, err }, "⚠️  Realtime channel error — broadcasts paused");
    } else if (status === "CLOSED") {
      _channelReady = false;
      logger.warn({ channel: ORDERS_CHANNEL }, "Realtime channel closed");
    }
  });
}

export async function broadcastOrderClaimed(orderId: string): Promise<void> {
  if (!_channel || !_channelReady) {
    logger.debug("broadcastOrderClaimed: channel not ready — skipping");
    return;
  }
  try {
    await _channel.send({
      type: "broadcast",
      event: EVENT_ORDER_CLAIMED,
      payload: { orderId },
    });
    logger.debug({ orderId }, "Order claimed broadcast sent");
  } catch (err) {
    logger.warn({ err }, "broadcastOrderClaimed: send failed");
  }
}

export async function broadcastOrderStatusChange(payload: {
  orderId: string;
  status: string;
  driverId?: string | null;
}): Promise<void> {
  if (!_channel || !_channelReady) {
    logger.debug("broadcastOrderStatusChange: channel not ready — skipping");
    return;
  }
  try {
    await _channel.send({
      type: "broadcast",
      event: EVENT_STATUS_CHANGED,
      payload,
    });
    logger.debug({ orderId: payload.orderId, status: payload.status }, "Order status change broadcast sent");
  } catch (err) {
    logger.warn({ err }, "broadcastOrderStatusChange: send failed");
  }
}

export const EVENT_NEW_ANNOUNCEMENT = "new_announcement";

export async function broadcastNewAnnouncement(payload: {
  id: string;
  title: string;
  content: string;
  targetAudience: string;
  badgeText: string | null;
  createdAt: string;
}): Promise<void> {
  if (!_channel || !_channelReady) {
    logger.debug("broadcastNewAnnouncement: channel not ready — skipping");
    return;
  }
  try {
    await _channel.send({
      type: "broadcast",
      event: EVENT_NEW_ANNOUNCEMENT,
      payload,
    });
    logger.debug({ id: payload.id }, "New announcement broadcasted");
  } catch (err) {
    logger.warn({ err }, "broadcastNewAnnouncement: send failed");
  }
}

export async function broadcastNewOrder(payload: {
  orderId: string;
  commune: string;
  wilaya: string;
  waterVolume: string;
  barrelCount: number;
}): Promise<void> {
  if (!_channel || !_channelReady) {
    logger.debug("broadcastNewOrder: channel not ready — skipping broadcast");
    return;
  }

  try {
    await _channel.send({
      type: "broadcast",
      event: "new_order",
      payload,
    });
    logger.debug({ orderId: payload.orderId, commune: payload.commune }, "New order broadcasted");
  } catch (err) {
    logger.warn({ err }, "broadcastNewOrder: send failed");
  }
}
