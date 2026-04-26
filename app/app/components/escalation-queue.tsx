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
    return <div style={{ opacity: 0.5, fontSize: "0.85rem" }}>no pending escalations</div>;
  }

  return (
    <div>
      {rows.map((row) => (
        <div
          key={row.id}
          style={{
            padding: "0.75rem",
            border: "1px solid #1f242c",
            borderRadius: 4,
            marginBottom: "0.5rem",
            display: "flex",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <div>
            <div style={{ fontSize: "0.85rem" }}>{row.reason}</div>
            <div style={{ fontSize: "0.7rem", opacity: 0.6 }}>
              agent {short(row.agent)} · {new Date(row.created_at).toLocaleTimeString()}
            </div>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              onClick={() => decide(row.id, "approve")}
              disabled={busy === row.id}
              style={btnApprove}
            >
              approve
            </button>
            <button
              onClick={() => decide(row.id, "reject")}
              disabled={busy === row.id}
              style={btnReject}
            >
              reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

const btnBase: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.8rem",
  padding: "0.3rem 0.7rem",
  borderRadius: 3,
  border: "1px solid #1f242c",
  cursor: "pointer",
};
const btnApprove: React.CSSProperties = { ...btnBase, background: "#173", color: "#dfe", borderColor: "#2a5" };
const btnReject: React.CSSProperties = { ...btnBase, background: "#511", color: "#fee", borderColor: "#933" };

function short(s: string) {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
