"use client";

import { useEffect, useMemo, useState } from "react";
import { relativeTime } from "../../lib/ui";

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
  const [seenIds, setSeenIds] = useState<Set<number>>(() => new Set());
  // Bumped each tick so relative timestamps refresh without rebuilding rows.
  const [, forceTick] = useState(0);

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

  // Periodically bump to refresh "Xs ago" labels.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

  // Track which event ids are new this render so we can attach the slide-in
  // class only to those rows. A re-render that doesn't add ids leaves the
  // earlier rows static.
  const newlyAdded = useMemo(() => {
    const adds = new Set<number>();
    for (const e of events) {
      if (!seenIds.has(e.id)) adds.add(e.id);
    }
    return adds;
  }, [events, seenIds]);

  useEffect(() => {
    if (newlyAdded.size === 0) return;
    setSeenIds((prev) => {
      const next = new Set(prev);
      for (const id of newlyAdded) next.add(id);
      return next;
    });
  }, [newlyAdded]);

  return (
    <div>
      <div
        className="sse-status"
        style={{
          marginBottom: "0.85rem",
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <span className={`sse-dot ${connected ? "connected" : "disconnected"}`} />
        SSE {connected ? "connected" : "disconnected"}
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span
          className={`status-pill ${pending > 0 ? "escalate" : "muted"}`}
          style={{ fontSize: "0.6rem" }}
        >
          <span className="pill-dot" />
          {pending} pending escalation{pending !== 1 ? "s" : ""}
        </span>
      </div>
      {events.length === 0 ? (
        <div className="empty-state">
          <span className="empty-glyph">⚡</span>
          <span className="empty-title">no events yet</span>
          <span className="empty-hint">
            fire a transaction or run{" "}
            <code style={{ color: "var(--accent-blue)" }}>pnpm seed</code>
          </span>
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
              const isNew = newlyAdded.has(e.id);
              return (
                <tr key={e.id} className={isNew ? "row-fade-in" : undefined}>
                  <td>
                    <KindPill kind={e.kind} />
                  </td>
                  <td
                    style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}
                    title={agentLabel}
                  >
                    {short(agentLabel)}
                  </td>
                  <td
                    style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}
                    title={dec?.rootHex ?? ""}
                  >
                    {dec?.rootHex ? `${dec.rootHex.slice(0, 8)}…` : "—"}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                    {e.signature ? short(e.signature) : "—"}
                  </td>
                  <td style={{ fontSize: "0.75rem", color: "var(--text-muted)" }} title={new Date(e.received_at).toLocaleString()}>
                    {relativeTime(e.received_at)}
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

function KindPill({ kind }: { kind: string }) {
  const map: Record<string, "allow" | "deny" | "info" | "muted"> = {
    registered: "allow",
    updated: "info",
    revoked: "deny",
  };
  const klass = map[kind] ?? "muted";
  return (
    <span className={`status-pill ${klass}`}>
      <span className="pill-dot" />
      {kind}
    </span>
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

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
