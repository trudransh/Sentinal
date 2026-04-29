"use client";

import { useCallback, useEffect, useState } from "react";

interface Row {
  id: string;
  agent: string;
  reason: string;
  requirements: string;
  status: "pending" | "approved" | "rejected";
  created_at: number;
}

export default function EscalationQueue() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/escalations", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { escalations: Row[] };
    setRows(data.escalations ?? []);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      await fetch("/api/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <div style={{ opacity: 0.4, fontSize: "0.8rem" }}>
        no pending escalations
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            padding: "0.75rem",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-secondary)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "1rem",
            transition: "border-color var(--transition-fast)",
          }}
        >
          <div>
            <div style={{ fontSize: "0.82rem", color: "var(--text-primary)" }}>{row.reason}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
              agent {short(row.agent)} · {new Date(row.created_at).toLocaleTimeString()}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
            <button
              onClick={() => decide(row.id, "approve")}
              disabled={busy === row.id}
              className="btn btn-primary"
            >
              approve
            </button>
            <button
              onClick={() => decide(row.id, "reject")}
              disabled={busy === row.id}
              className="btn btn-danger"
            >
              reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function short(s: string) {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
