"use client";

import { useEffect, useState } from "react";

interface PolicyEventRow {
  id: number;
  kind: string;
  agent: string;
  signature: string | null;
  payload: string;
  received_at: number;
  decoded: string | null;
}

interface DecodedShape {
  kind: "registered" | "updated" | "revoked" | "unknown";
  agent: string;
  policyPda: string | null;
  owner: string | null;
  rootHex: string | null;
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
              <th>root</th>
              <th>signature</th>
              <th>received</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const dec = parseDecoded(e.decoded);
              const agentLabel =
                dec?.agent && dec.agent !== "unknown" ? dec.agent : e.agent;
              return (
                <tr key={e.id} style={{ borderTop: "1px solid #1f242c" }}>
                  <td>
                    <span style={kindStyle(e.kind)}>{e.kind}</span>
                  </td>
                  <td title={agentLabel}>{short(agentLabel)}</td>
                  <td title={dec?.rootHex ?? ""}>
                    {dec?.rootHex ? `${dec.rootHex.slice(0, 8)}…` : "—"}
                  </td>
                  <td>{e.signature ? short(e.signature) : "—"}</td>
                  <td>{new Date(e.received_at).toLocaleTimeString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function parseDecoded(s: string | null): DecodedShape | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as DecodedShape;
  } catch {
    return null;
  }
}

function kindStyle(kind: string): React.CSSProperties {
  const colors: Record<string, [string, string]> = {
    registered: ["#173", "#dfe"],
    updated: ["#137", "#dde"],
    revoked: ["#511", "#fee"],
  };
  const [bg, fg] = colors[kind] ?? ["#222", "#aaa"];
  return {
    background: bg,
    color: fg,
    padding: "0.1rem 0.4rem",
    borderRadius: 3,
    fontSize: "0.7rem",
  };
}

function short(s: string) {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
