/**
 * Socket.io client singleton.
 *
 * Security: the sessionToken is passed in the Socket.io handshake `auth`
 * object — not in a post-connect event payload. The server validates it in
 * io.use() middleware before accepting the connection. If the token is
 * missing or invalid the server rejects with UNAUTHORIZED and the socket
 * remains disconnected (no event handlers run).
 *
 * Using a callback for `auth` means socket.io-client re-reads localStorage
 * on every reconnect attempt, so a re-logged-in user gets the right token
 * even after an automatic reconnect.
 *
 * Reconnection: exponential backoff 1 s → 30 s, infinite retries.
 */

import { io, type Socket } from "socket.io-client";

let _socket: Socket | null = null;

function getApiOrigin(): string {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined ?? "").replace(/\/+$/, "");
  if (configured) return configured;
  return window.location.origin;
}

export function getSocket(): Socket {
  if (_socket) return _socket;

  _socket = io(getApiOrigin(), {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30_000,
    reconnectionAttempts: Infinity,
    timeout: 20_000,
    // ── Authentication ──────────────────────────────────────────────────────
    // Using a callback so the token is read from localStorage on every
    // connection attempt (including reconnects), not just at module load time.
    auth: (cb: (data: Record<string, string>) => void) => {
      const token = localStorage.getItem("sessionToken") ?? "";
      cb({ sessionToken: token });
    },
  });

  return _socket;
}

/**
 * Register this client's room subscriptions with the server.
 * The server already knows the validated userId from the session token —
 * this just tells the server which rooms to join for this socket.
 *
 * @param isDriver  If true, also joins the shared "drivers" broadcast room.
 */
export function registerUser(isDriver: boolean): void {
  const s = getSocket();
  s.emit("register");
  if (isDriver) {
    s.emit("register_driver");
  }
}
