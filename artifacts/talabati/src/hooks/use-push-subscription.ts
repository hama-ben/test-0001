/**
 * usePushSubscription
 *
 * Registers the service worker, requests Notification permission (once),
 * and POSTs the resulting PushSubscription to /api/push/subscribe so the
 * server can deliver Web Push notifications when the tab is closed.
 *
 * Fails silently on unsupported browsers or when the user denies permission.
 */

import { useEffect } from "react";

const STORAGE_KEY = "mizu_push_subscribed";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

async function subscribe(userId: string): Promise<void> {
  // Avoid re-subscribing on every mount once already done
  if (sessionStorage.getItem(STORAGE_KEY) === userId) return;

  const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapidKey) return; // key not injected — skip silently

  // 1. Register (or reuse existing) service worker
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;

  // 2. Request permission — don't re-ask if already answered
  if (Notification.permission === "denied") return;
  if (Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") return;
  }

  // 3. Subscribe to push
  const pushSub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: new Uint8Array(urlBase64ToUint8Array(vapidKey)),
  });

  // 4. Send subscription to server
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, subscription: pushSub.toJSON() }),
  });

  sessionStorage.setItem(STORAGE_KEY, userId);
}

export function usePushSubscription(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    subscribe(userId).catch(() => {
      // Fail silently — push is an enhancement, not a requirement
    });
  }, [userId]);
}
