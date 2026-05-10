"use client";

import { useCallback, useEffect, useState } from "react";
import { relativeTime, urgencyTier } from "../../lib/ui";
import { ROTATE_POLICY_EVENT, type RotatePolicyEvent } from "./escalation-approver";

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
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{
    id: string;
    action: "approve" | "reject";
  } | null>(null);
  // Re-render cadence so urgency tier + relative time refresh.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);

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
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = process.env.NEXT_PUBLIC_SENTINEL_DASHBOARD_TOKEN;
      if (token) headers["x-sentinel-token"] = token;

      const r = await fetch("/api/escalations", {
        method: "POST",
        headers,
        body: JSON.stringify({ id, action }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { message?: string };
        const msg =
          r.status === 401
            ? "auth failed (401) — set SENTINEL_DASHBOARD_TOKEN + NEXT_PUBLIC_SENTINEL_DASHBOARD_TOKEN to the same value, or unset both in dev"
            : body.message ?? `HTTP ${r.status}`;
        setError(msg);
        return;
      }
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  function rotatePolicy(row: Row) {
    // Hand off to EscalationApprover via a CustomEvent so we don't have to
    // lift the on-chain modal state into the page.
    const detail: RotatePolicyEvent = { id: row.id, agent: row.agent };
    window.dispatchEvent(new CustomEvent(ROTATE_POLICY_EVENT, { detail }));
  }

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <span className="empty-glyph">✓</span>
        <span className="empty-title">no pending escalations</span>
        <span className="empty-hint">all agent activity is within policy</span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.55rem" }}>
      {error && (
        <div
          className="status-pill deny"
          style={{
            padding: "0.55rem 0.75rem",
            fontSize: "0.72rem",
            alignItems: "flex-start",
          }}
        >
          <span className="pill-dot" style={{ flexShrink: 0, marginTop: "0.15rem" }} />
          <span style={{ wordBreak: "break-word", flex: 1 }}>{error}</span>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: "0.9rem",
              padding: 0,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}
      {rows.map((row) => {
        const tier = urgencyTier(row.created_at);
        const tierLabel =
          tier === "urgent" ? "urgent" : tier === "warm" ? "warm" : "fresh";
        const isConfirming = confirming?.id === row.id;
        return (
          <div
            key={row.id}
            style={{
              padding: "0.85rem 0.9rem",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-md)",
              background: "var(--bg-secondary)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: "0.85rem",
              transition:
                "border-color var(--transition-fast), box-shadow var(--transition-fast)",
              boxShadow:
                tier === "urgent"
                  ? "0 0 0 1px var(--accent-red-border), 0 0 18px rgba(248, 113, 113, 0.07)"
                  : "none",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  gap: "0.4rem",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <span className={`urgency ${tier}`}>{tierLabel}</span>
                <span
                  style={{
                    fontSize: "0.84rem",
                    color: "var(--text-primary)",
                    fontWeight: 500,
                  }}
                >
                  {row.reason}
                </span>
              </div>
              <div
                style={{
                  fontSize: "0.68rem",
                  color: "var(--text-muted)",
                  marginTop: "0.3rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                agent {short(row.agent)} · {relativeTime(row.created_at)}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.4rem", flexShrink: 0 }}>
              {isConfirming ? (
                <>
                  <button
                    onClick={() => decide(row.id, confirming.action)}
                    disabled={busy === row.id}
                    className={`btn ${
                      confirming.action === "approve"
                        ? "btn-primary"
                        : "btn-danger"
                    } confirming`}
                  >
                    confirm {confirming.action}
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="btn btn-ghost"
                  >
                    cancel
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setConfirming({ id: row.id, action: "approve" })}
                    disabled={busy === row.id}
                    className="btn btn-primary"
                  >
                    approve
                  </button>
                  <button
                    onClick={() => setConfirming({ id: row.id, action: "reject" })}
                    disabled={busy === row.id}
                    className="btn btn-danger"
                  >
                    reject
                  </button>
                  <button
                    onClick={() => rotatePolicy(row)}
                    disabled={busy === row.id}
                    className="btn btn-ghost"
                    title="approve + sign update_policy on-chain (requires Phantom)"
                    style={{ fontSize: "0.7rem" }}
                  >
                    rotate
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}
