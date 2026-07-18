/**
 * useTokenRefresh
 *
 * Mounts the proactive JWT refresh scheduler when the user is logged in.
 * Automatically reschedules whenever the userId changes (login/logout).
 *
 * Mount this once at the App root so it is always active.
 */

import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { scheduleProactiveRefresh } from "@/lib/token-refresh";

export function useTokenRefresh(): void {
  const userId = useAuth((s) => s.userId);

  useEffect(() => {
    if (!userId) return; // Not logged in — nothing to refresh
    const cleanup = scheduleProactiveRefresh();
    return cleanup;
  }, [userId]);
}
