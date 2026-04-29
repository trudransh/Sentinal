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
      <div className="sse-status" style={{ marginBottom: "0.75rem" }}>
        <span className={`sse-dot ${connected ? "connected" : "disconnected"}`} />
        SSE {connected ? "connected" : "disconnected"}
        <span style={{ marginLeft: "0.5rem" }}>·</span>
        <span style={{ marginLeft: "0.5rem" }}>
          {pending} pending escalation{pending !== 1 ? "s" : ""}
        </span>
      </div>
      {events.length === 0 ? (
        <div style={{ opacity: 0.4, fontSize: "0.8rem" }}>
          no events yet — fire a transaction or run <code style={{ color: "var(--accent-blue)" }}>pnpm seed</code>
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
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
                <tr key={e.id}>
                  <td>
                    <span className={`badge ${kindBadgeClass(e.kind)}`}>{e.kind}</span>
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }} title={agentLabel}>
                    {short(agentLabel)}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }} title={dec?.rootHex ?? ""}>
                    {dec?.rootHex ? `${dec.rootHex.slice(0, 8)}…` : "—"}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {e.signature ? short(e.signature) : "—"}
                  </td>
                  <td style={{ fontSize: "0.75rem" }}>
                    {new Date(e.received_at).toLocaleTimeString()}
                  </td>
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

function kindBadgeClass(kind: string): string {
  switch (kind) {
    case "registered": return "badge-green";
    case "updated": return "badge-blue";
    case "revoked": return "badge-red";
    default: return "badge-yellow";
  }
}

function short(s: string) {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
