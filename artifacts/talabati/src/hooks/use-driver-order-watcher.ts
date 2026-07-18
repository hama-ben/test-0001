/**
 * useDriverOrderWatcher
 *
 * A lightweight, always-on Supabase Realtime subscription that runs
 * whenever a driver is logged in — regardless of which page they're on.
 *
 * On every `new_order` broadcast it increments the global
 * useOrderNotificationStore so the nav badge stays in sync.
 *
 * Failures are fully isolated and never propagate to Auth/OTP state.
 */
import { useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useOrderNotificationStore } from "@/stores/order-notifications";

export function useDriverOrderWatcher(enabled: boolean) {
  const increment = useOrderNotificationStore((s) => s.increment);

  useEffect(() => {
    if (!enabled) return;

    let channel: ReturnType<typeof supabase.channel> | null = null;

    try {
      channel = supabase
        .channel("driver-nav-notifications")
        .on("broadcast", { event: "new_order" }, () => {
          increment();
        })
        .subscribe((status, err) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn("[NavWatcher] Realtime error (non-fatal):", err ?? status);
          }
        });
    } catch (err) {
      console.warn("[NavWatcher] Channel init failed (non-fatal):", err);
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {
          // non-fatal
        }
      }
    };
  }, [enabled, increment]);
}
