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
    <div style={overlay}>
      <div style={card}>
        <h3 style={{ margin: "0 0 0.5rem 0" }}>Approval required</h3>
        <p style={{ margin: 0, opacity: 0.85, fontSize: "0.9rem" }}>{approval.reason}</p>
        <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", opacity: 0.6 }}>
          agent: {approval.agent}
        </div>
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onResolved(approval.id, "reject");
              setBusy(false);
            }}
            style={btnReject}
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
            style={btnApprove}
          >
            approve
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};
const card: React.CSSProperties = {
  background: "#13171c",
  border: "1px solid #1f242c",
  borderRadius: 6,
  padding: "1.25rem",
  width: "min(440px, 90%)",
};
const btnBase: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.85rem",
  padding: "0.4rem 0.9rem",
  borderRadius: 3,
  cursor: "pointer",
};
const btnApprove: React.CSSProperties = { ...btnBase, background: "#173", color: "#dfe", border: "1px solid #2a5" };
const btnReject: React.CSSProperties = { ...btnBase, background: "#511", color: "#fee", border: "1px solid #933" };
