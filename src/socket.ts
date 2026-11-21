import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, Role, ServerMsg } from "./shared";

/** Sunucuya WebSocket ile bağlanır, koparsa kendiliğinden yeniden bağlanır. */
export function useSocket(role: Role, onMessage: (m: ServerMsg) => void) {
  const handler = useRef(onMessage);
  handler.current = onMessage;
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws?role=${role}`);
      wsRef.current = ws;
      ws.onopen = () => setConnected(true);
      ws.onmessage = e => handler.current(JSON.parse(e.data));
      ws.onclose = () => {
        setConnected(false);
        if (!closed) timer = setTimeout(connect, 1000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      wsRef.current?.close();
    };
  }, [role]);

  const send = useCallback((m: ClientMsg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(m));
  }, []);

  return { send, connected };
}
