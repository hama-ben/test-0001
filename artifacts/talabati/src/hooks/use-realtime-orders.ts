/**
 * useRealtimeOrders  (driver-side)
 *
 * Dual-layer real-time subscription for new orders:
 *   PRIMARY  — Socket.io "new_order" event from the backend server.
 *   FALLBACK — Supabase Realtime broadcast (in case Socket.io is unavailable).
 *
 * When either layer fires:
 *   1. Invalidates the active-orders React Query cache for this driver
 *      (the server re-fetches and filters by commune server-side).
 *   2. Shows a notification once the count actually increases (zero false positives).
 *
 * Polling fallback: React Query's refetchInterval ensures the driver list
 * updates every POLL_INTERVAL_MS even when both WebSocket layers are down
 * (e.g. unstable mobile networks or in-app browsers).
 *
 * Connection isolation: all errors are caught silently — no failure here
 * can propagate into the auth/OTP flow or any other part of the app.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getSocket } from "@/lib/socket-client";
import { getGetActiveOrdersQueryKey } from "@workspace/api-client-react";

const EVENT_ORDER_CLAIMED = "order_claimed";
export const DRIVER_POLL_INTERVAL_MS = 8_000;

export function useRealtimeOrders(driverId: string, currentOrderCount: number) {
  const queryClient = useQueryClient();
  const [notification, setNotification] = useState(false);

  const prevCountRef = useRef(-1);
  const pendingBroadcastRef = useRef(false);

  // Detect a commune-matched new order: count must increase AND a broadcast
  // must have arrived since the last refetch. Prevents false positives.
  useEffect(() => {
    if (prevCountRef.current === -1) {
      prevCountRef.current = currentOrderCount;
      return;
    }

    if (pendingBroadcastRef.current && currentOrderCount > prevCountRef.current) {
      setNotification(true);
      pendingBroadcastRef.current = false;
    }

    prevCountRef.current = currentOrderCount;
  }, [currentOrderCount]);

  const handleNewOrder = useCallback(() => {
    pendingBroadcastRef.current = true;
    queryClient.invalidateQueries({
      queryKey: getGetActiveOrdersQueryKey({ driverId }),
    });
  }, [driverId, queryClient]);

  const handleOrderClaimed = useCallback((claimedId: string) => {
    queryClient.setQueryData(
      getGetActiveOrdersQueryKey({ driverId }),
      (old: unknown) => {
        if (!Array.isArray(old)) return old;
        return old.filter((o: { id: string }) => o.id !== claimedId);
      }
    );
  }, [driverId, queryClient]);

  // ── PRIMARY: Socket.io subscription ──────────────────────────────────────
  useEffect(() => {
    let socket: ReturnType<typeof getSocket> | null = null;

    try {
      socket = getSocket();

      socket.on("new_order", handleNewOrder);
      socket.on("order_claimed", (payload: { orderId?: string }) => {
        if (payload?.orderId) handleOrderClaimed(payload.orderId);
      });
    } catch (err) {
      console.warn("[Socket] Driver subscription setup failed (non-fatal):", err);
    }

    return () => {
      if (socket) {
        try {
          socket.off("new_order", handleNewOrder);
          socket.off("order_claimed");
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, [handleNewOrder, handleOrderClaimed]);

  // ── FALLBACK: Supabase Realtime ────────────────────────────────────────────
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel("orders:new")
        .on("broadcast", { event: "new_order" }, handleNewOrder)
        .on("broadcast", { event: EVENT_ORDER_CLAIMED }, (payload: { payload?: { orderId?: string } }) => {
          const claimedId = payload?.payload?.orderId;
          if (claimedId) handleOrderClaimed(claimedId);
        })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[Realtime] Driver channel error (non-fatal):", err ?? status);
          }
        });
    } catch (err) {
      console.warn("[Realtime] Driver channel init failed (non-fatal):", err);
    }

    return () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch { /* ignore */ }
      }
    };
  }, [handleNewOrder, handleOrderClaimed]);

  const dismiss = useCallback(() => setNotification(false), []);

  return { notification, dismiss };
}
