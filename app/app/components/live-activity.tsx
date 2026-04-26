"use client";

import { useEffect, useState } from "react";

interface PolicyEventRow {
  id: number;
  kind: string;
  agent: string;
  signature: string | null;
  payload: string;
  received_at: number;
}

export default function LiveActivity() {
  const [events, setEvents] = useState<PolicyEventRow[]>([]);
  const [pending, setPending] = useState<number>(0);
  const [connected, setConnected] = useState<boolean>(false);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("tick", (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as {
          events: PolicyEventRow[];
          pending: number;
        };
        setEvents(data.events ?? []);
        setPending(data.pending ?? 0);
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  return (
    <div>
      <div style={{ fontSize: "0.75rem", opacity: 0.6, marginBottom: "0.5rem" }}>
        SSE: {connected ? "connected" : "disconnected"} · pending escalations:{" "}
        {pending}
      </div>
      {events.length === 0 ? (
        <div style={{ opacity: 0.5 }}>no events yet</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
          <thead>
            <tr style={{ textAlign: "left", opacity: 0.6 }}>
              <th>kind</th>
              <th>agent</th>
              <th>signature</th>
              <th>received</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} style={{ borderTop: "1px solid #1f242c" }}>
                <td>{e.kind}</td>
                <td>{short(e.agent)}</td>
                <td>{e.signature ? short(e.signature) : "—"}</td>
                <td>{new Date(e.received_at).toLocaleTimeString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function short(s: string) {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
