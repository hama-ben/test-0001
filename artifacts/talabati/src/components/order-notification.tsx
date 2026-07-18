/**
 * OrderNotification
 *
 * Animated toast banner that slides down from the top of the screen
 * when a new order arrives in the driver's commune via Supabase Realtime.
 * Auto-dismisses after 8 seconds; also dismissible by tapping.
 * Clicking the banner navigates to /driver-dashboard (pending orders).
 * Plays the driver's preferred notification ringtone on appearance.
 *
 * Audio stop contract:
 *  - Every dismiss path (X button, banner click, auto-timeout, unmount)
 *    calls stopNotificationSound() so custom audio never outlives the UI.
 */

import { useEffect, useRef, useCallback } from "react";
import { Bell, X, Package } from "lucide-react";
import { useLocation } from "wouter";
import {
  playNotificationSound,
  stopNotificationSound,
  DRIVER_ORDER_SOUND_KEY,
} from "@/hooks/use-notification-sound";

interface OrderNotificationProps {
  show: boolean;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 8000;

export function OrderNotification({ show, onDismiss }: OrderNotificationProps) {
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setLocation] = useLocation();

  // Wrap dismiss so every path (button, click, timeout, cleanup) goes through
  // the same function which always stops audio first.
  const dismiss = useCallback(() => {
    stopNotificationSound();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    if (!show) return;

    // Play the driver's chosen ringtone
    playNotificationSound(DRIVER_ORDER_SOUND_KEY);

    // Haptic vibration on supported devices
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100]);
    }

    timerRef.current = setTimeout(dismiss, AUTO_DISMISS_MS);

    // Cleanup: stop audio if the component unmounts or `show` flips to false
    // before the timer fires (e.g. navigation away from the page).
    return () => {
      stopNotificationSound();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [show, dismiss]);

  if (!show) return null;

  const handleClick = () => {
    dismiss();
    setLocation("/driver-dashboard");
  };

  return (
    <div
      className="w-full animate-in slide-in-from-top-4 fade-in duration-400"
      dir="rtl"
    >
      <button
        onClick={handleClick}
        className="w-full flex items-center gap-4 p-4 rounded-3xl shadow-2xl border border-primary/20 cursor-pointer bg-gradient-to-l from-primary to-cyan-500 text-white"
        aria-label="عرض الطلبات المتاحة"
      >
        {/* Pulsing bell icon */}
        <div className="relative flex-shrink-0">
          <div className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
          <div className="relative w-11 h-11 rounded-full bg-white/20 flex items-center justify-center">
            <Bell className="w-6 h-6 text-white fill-white" />
          </div>
        </div>

        {/* Text */}
        <div className="flex-1 text-right">
          <p className="font-black text-base leading-tight">طلب جديد في منطقتك! 🔔</p>
          <p className="text-white/80 text-sm font-medium mt-0.5 flex items-center gap-1.5 justify-end">
            <Package className="w-3.5 h-3.5" />
            اضغط لعرض الطلبات المتاحة
          </p>
        </div>

        {/* Close button */}
        <button
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
          className="flex-shrink-0 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
          aria-label="إغلاق"
        >
          <X className="w-4 h-4 text-white" />
        </button>
      </button>
    </div>
  );
}
