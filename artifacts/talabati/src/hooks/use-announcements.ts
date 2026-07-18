import { useState, useEffect, useCallback } from "react";
import { customFetch } from "@workspace/api-client-react";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/hooks/use-toast";

export interface Announcement {
  id: string;
  title: string;
  content: string;
  targetAudience: string;
  badgeText: string | null;
  createdAt: string;
  isRead: boolean;
}

// Audience values the admin panel saves — must match what the server filters on.
const DRIVER_AUDIENCES   = new Set(["Everyone", "Drivers",   "all", "سائق",    "driver"]);
const CUSTOMER_AUDIENCES = new Set(["Everyone", "Customers", "Consumers", "all", "مستهلك", "customer"]);

function matchesAudience(targetAudience: string, userType: "driver" | "customer"): boolean {
  return userType === "driver"
    ? DRIVER_AUDIENCES.has(targetAudience)
    : CUSTOMER_AUDIENCES.has(targetAudience);
}

export function useAnnouncements(userId: string | null, userType: "driver" | "customer") {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const { toast } = useToast();

  const fetchAnnouncements = useCallback(async () => {
    if (!userId) return;
    try {
      const data = await customFetch<Announcement[]>("/api/announcements");

      // Defense-in-depth: even if the server returns rows it shouldn't have,
      // only keep rows that are either:
      //   (a) a broadcast to this user's type (Everyone / Drivers / Customers / etc.)
      //   (b) targeted exactly at this user's id
      // This prevents a backend bug or misconfigured RLS from leaking another
      // driver's private notifications (document approval, payment, etc.) to us.
      const safe = (data ?? []).filter(a =>
        matchesAudience(a.targetAudience, userType) || a.targetAudience === userId
      );

      setAnnouncements(safe);
    } catch {
      // silently ignore — auth not ready yet or network error
    }
  }, [userId, userType]);

  // Initial fetch + 30-second polling fallback
  useEffect(() => {
    fetchAnnouncements();
    const id = setInterval(fetchAnnouncements, 30_000);
    return () => clearInterval(id);
  }, [fetchAnnouncements]);

  // Supabase Realtime — postgres_changes fires the moment admin saves to Supabase.
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`announcements:${userType}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table: "announcements" },
        (payload: { new: Record<string, unknown> }) => {
          const r = payload.new;
          if (!r?.id || r.is_active === false) return;

          const targetAudience = String(r.target_audience ?? "");
          if (!matchesAudience(targetAudience, userType) && targetAudience !== userId) return;

          const newAnn: Announcement = {
            id:             String(r.id),
            title:          String(r.title ?? ""),
            content:        String(r.content ?? ""),
            targetAudience,
            badgeText:      r.badge_text != null ? String(r.badge_text) : null,
            createdAt:      String(r.created_at ?? new Date().toISOString()),
            isRead:         false,
          };

          setAnnouncements(prev => {
            if (prev.some(a => a.id === newAnn.id)) return prev;
            return [newAnn, ...prev];
          });

          toast({
            title:       "إعلان جديد من الإدارة 📢",
            description: newAnn.title,
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, userType, toast]);

  /**
   * Dismiss a single announcement: persist to server + remove from local state.
   * Works for both manual dismiss and auto-expire.
   */
  const dismissAnnouncement = useCallback(async (id: string) => {
    if (!userId) return;
    // Optimistically remove from local state immediately
    setAnnouncements(prev => prev.filter(a => a.id !== id));
    try {
      await customFetch<{ marked: number }>("/api/announcements/mark-read", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ announcementIds: [id], userType }),
      });
    } catch {
      // silently ignore — worst case it reappears on next poll
    }
  }, [userId, userType]);

  const unreadCount = announcements.filter(a => !a.isRead).length;

  return { announcements, unreadCount, dismissAnnouncement, refetch: fetchAnnouncements };
}
