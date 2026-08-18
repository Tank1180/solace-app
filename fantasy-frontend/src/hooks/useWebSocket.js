import { useEffect, useRef } from "react";

export default function useWebSocket(leagueId, onMessage) {
  const ws = useRef(null);

  const connect = () => {
    const WS_BASE = "ws://localhost:8000";
    ws.current = new WebSocket(`${WS_BASE}/ws/draft/${leagueId}`);

    ws.current.onopen = () => {
      console.log("WS connected");
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("WS message:", data);
      onMessage(data);
    };

    ws.current.onclose = () => {
      console.log("WS closed — reconnecting...");
      setTimeout(connect, 500);
    };
  };

  useEffect(() => {
    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, [leagueId]);

  const send = (event, payload) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ event, payload }));
      console.log("WS send:", { event, payload });
    } else {
      console.warn("WS not open — cannot send message");
    }
  };

  return { send };
}