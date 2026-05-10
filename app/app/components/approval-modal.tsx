"use client";

import { useEffect, useState } from "react";

export interface PendingApproval {
  id: string;
  agent: string;
  reason: string;
}

export default function ApprovalModal({
  approval,
  onResolved,
}: {
  approval: PendingApproval | null;
  onResolved: (id: string, action: "approve" | "reject") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!approval) return;
      if (e.key === "Escape") void onResolved(approval.id, "reject");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [approval, onResolved]);

  if (!approval) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.5rem",
          }}
        >
          <span className="status-pill escalate">
            <span className="pill-dot" />
            approval required
          </span>
        </div>
        <h3
          style={{
            margin: "0 0 0.35rem 0",
            fontSize: "1.1rem",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          {approval.reason}
        </h3>
        <div
          style={{
            marginTop: "0.5rem",
            fontSize: "0.72rem",
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            wordBreak: "break-all",
          }}
        >
          agent: {approval.agent}
        </div>
        <div
          style={{
            marginTop: "1.25rem",
            display: "flex",
            gap: "0.5rem",
            justifyContent: "flex-end",
          }}
        >
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onResolved(approval.id, "reject");
              setBusy(false);
            }}
            className="btn btn-danger"
          >
            reject
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onResolved(approval.id, "approve");
              setBusy(false);
            }}
            className="btn btn-primary"
          >
            approve
          </button>
        </div>
      </div>
    </div>
  );
}
