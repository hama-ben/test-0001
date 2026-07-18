/**
 * useSocketConnection
 *
 * Tracks the Socket.io connection state and handles room registration with
 * the server on every (re)connect.
 *
 * Security: the session token is passed in the Socket.io handshake (in
 * socket-client.ts), not here. The server validates the token before
 * accepting the connection. This hook only emits "register" / "register_driver"
 * room-join events after the authenticated connection is established.
 *
 * Returns a connection state string so the Layout can show an appropriate
 * indicator ("Connecting…" / "Reconnecting…" / "Offline").
 */

import { useEffect, useRef, useState } from "react";
import { getSocket, registerUser } from "@/lib/socket-client";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export function useSocketConnection(userId: string | null, isDriver: boolean): ConnectionState {
  const [state, setState] = useState<ConnectionState>("connecting");
  const isDriverRef = useRef(isDriver);

  useEffect(() => {
    isDriverRef.current = isDriver;
  });

  useEffect(() => {
    if (!userId) return;

    const socket = getSocket();

    const onConnect = () => {
      setState("connected");
      // Tell the server which rooms to join for this authenticated socket.
      // The server resolves the actual userId from the validated session token —
      // we never send userId in an event payload.
      registerUser(isDriver);
    };

    const onDisconnect = () => {
      setState("offline");
    };

    const onReconnectAttempt = () => {
      setState("reconnecting");
    };

    const onReconnect = () => {
      setState("connected");
      registerUser(isDriverRef.current);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.io.on("reconnect_attempt", onReconnectAttempt);
    socket.io.on("reconnect", onReconnect);

    // Handle already-connected case (hook mounted after initial connect)
    if (socket.connected) {
      setState("connected");
      registerUser(isDriver);
    }

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.io.off("reconnect_attempt", onReconnectAttempt);
      socket.io.off("reconnect", onReconnect);
    };
  }, [userId, isDriver]);

  return state;
}
