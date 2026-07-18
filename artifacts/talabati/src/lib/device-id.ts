const LS_KEY     = "mizu_device_id";
const COOKIE_KEY = "mizu_did";

function readFromCookie(): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

function persistToAll(id: string): void {
  try { localStorage.setItem(LS_KEY, id); } catch { /* storage blocked */ }
  try {
    const exp = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${COOKIE_KEY}=${encodeURIComponent(id)}; expires=${exp}; path=/; SameSite=Lax`;
  } catch { /* cookies blocked */ }
}

export function getDeviceId(): string {
  // 1. GoNative / Median Android bridge (most stable for APK)
  try {
    const uuid = (window as any)?.gonative?.deviceInfo?.uuid
      ?? (window as any)?.median?.deviceInfo?.uuid;
    if (uuid && typeof uuid === "string") return uuid;
  } catch { /* no bridge */ }

  // 2. localStorage
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) { persistToAll(stored); return stored; }
  } catch { /* storage blocked */ }

  // 3. Cookie fallback (survives localStorage clears)
  const fromCookie = readFromCookie();
  if (fromCookie) { persistToAll(fromCookie); return fromCookie; }

  // 4. Generate fresh ID and persist everywhere
  const newId = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  persistToAll(newId);
  return newId;
}
