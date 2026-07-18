/**
 * useRealtimeOrderStatus  (consumer-side)
 *
 * Dual-layer real-time subscription for order status changes:
 *   PRIMARY  — Socket.io "order_status_changed" event targeted to this
 *              consumer's userId room (server → specific consumer).
 *   FALLBACK — Supabase Realtime broadcast channel.
 *
 * Polling fallback: the React Query cache is also kept fresh by
 * refetchInterval so status updates arrive even when both WebSocket
 * layers are down (unstable mobile networks / in-app browsers).
 *
 * All errors are isolated here — a failure here never propagates into
 * auth, OTP, or any other part of the application.
 */

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getSocket } from "@/lib/socket-client";
import { getGetUserOrdersQueryKey } from "@workspace/api-client-react";

export const CONSUMER_POLL_INTERVAL_MS = 8_000;

export function useRealtimeOrderStatus(userId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;

    const invalidate = () => {
      queryClient.invalidateQueries({
        queryKey: getGetUserOrdersQueryKey(userId),
      });
    };

    // ── PRIMARY: Socket.io ──────────────────────────────────────────────────
    let socket: ReturnType<typeof getSocket> | null = null;
    try {
      socket = getSocket();
      socket.on("order_status_changed", invalidate);
    } catch (err) {
      console.warn("[Socket] Consumer subscription setup failed (non-fatal):", err);
    }

    // ── FALLBACK: Supabase Realtime ──────────────────────────────────────────
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase
        .channel("consumer:order-status")
        .on("broadcast", { event: "order_status_changed" }, invalidate)
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[Realtime] Consumer channel error (non-fatal):", err ?? status);
          }
        });
    } catch (err) {
      console.warn("[Realtime] Consumer channel setup failed (non-fatal):", err);
    }

    return () => {
      if (socket) {
        try { socket.off("order_status_changed", invalidate); } catch { /* ignore */ }
      }
      if (channel) {
        try { supabase.removeChannel(channel); } catch { /* ignore */ }
      }
    };
  }, [userId, queryClient]);
}
