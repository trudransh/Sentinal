"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import ApprovalModal, { type PendingApproval } from "./approval-modal";

interface EscalationRow {
  id: string;
  agent: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  created_at: number;
}

// update_policy discriminator from target/idl/sentinel_registry.json
const UPDATE_POLICY_DISCRIMINATOR = new Uint8Array([
  212, 245, 246, 7, 163, 151, 18, 57,
]);

// B1: subscribes to /api/escalations, mounts approval-modal for the first
// pending row, and routes "approve_and_update" through the connected wallet.
// The wallet signs an update_policy ix client-side (Phantom/Ledger), the
// dashboard server is only responsible for the off-chain SQLite state change.
export default function EscalationApprover({
  programId,
}: {
  programId: string | undefined;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();
  const [pending, setPending] = useState<EscalationRow[]>([]);
  const [showUpdate, setShowUpdate] = useState(false);
  const [agentInput, setAgentInput] = useState("");
  const [rootInput, setRootInput] = useState("");
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const programPk = useMemo(() => {
    if (!programId) return null;
    try {
      return new PublicKey(programId);
    } catch {
      return null;
    }
  }, [programId]);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/escalations", { cache: "no-store" });
    if (!r.ok) return;
    const data = (await r.json()) as { escalations: EscalationRow[] };
    setPending(data.escalations ?? []);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const first = pending[0] ?? null;
  const approval: PendingApproval | null = first
    ? { id: first.id, agent: first.agent, reason: first.reason }
    : null;

  async function resolveOffChain(id: string, action: "approve" | "reject") {
    await fetch("/api/escalations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    await refresh();
  }

  async function approveAndUpdate(id: string) {
    setErrorMsg(null);
    if (!programPk) {
      setErrorMsg("SENTINEL_REGISTRY_PROGRAM_ID is not set");
      return;
    }
    if (!connected || !publicKey || !signTransaction) {
      setErrorMsg("connect a wallet first");
      return;
    }
    let agentPk: PublicKey;
    try {
      agentPk = new PublicKey(agentInput.trim());
    } catch {
      setErrorMsg("invalid agent pubkey");
      return;
    }
    const rootHex = rootInput.trim().replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{64}$/.test(rootHex)) {
      setErrorMsg("root must be 64 hex chars (32 bytes)");
      return;
    }
    const rootBytes = new Uint8Array(
      rootHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );

    const [policyPda] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("policy"), agentPk.toBuffer()],
      programPk,
    );

    const data = new Uint8Array(8 + 32);
    data.set(UPDATE_POLICY_DISCRIMINATOR, 0);
    data.set(rootBytes, 8);

    const ix = new TransactionInstruction({
      programId: programPk,
      keys: [
        { pubkey: publicKey, isSigner: true, isWritable: false },
        { pubkey: policyPda, isSigner: false, isWritable: true },
      ],
      data: Buffer.from(data),
    });

    setBusyMsg("requesting signature…");
    try {
      const tx = new Transaction().add(ix);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
      const signed = await signTransaction(tx);
      setBusyMsg("broadcasting…");
      const sig = await connection.sendRawTransaction(signed.serialize());
      setBusyMsg(`confirming ${sig.slice(0, 8)}…`);
      await connection.confirmTransaction(sig, "confirmed");
      setBusyMsg(`confirmed ${sig}`);
      await fetch("/api/escalations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "approve_and_update" }),
      });
      setShowUpdate(false);
      setAgentInput("");
      setRootInput("");
      await refresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => setBusyMsg(null), 4000);
    }
  }

  const onResolved = async (id: string, action: "approve" | "reject") => {
    if (action === "approve") {
      // Open the on-chain update panel; off-chain "approve" without rotating
      // the policy is rarely what the operator wants in production.
      setShowUpdate(true);
      return;
    }
    await resolveOffChain(id, action);
  };

  return (
    <>
      <ApprovalModal approval={approval} onResolved={onResolved} />
      {showUpdate && approval && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem", fontWeight: 600 }}>Approve &amp; update policy</h3>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.8rem" }}>
              The connected wallet will sign an <code style={{ color: "var(--accent-blue)" }}>update_policy</code> ix on devnet.
              Paste the agent pubkey and the new sha256 policy root.
            </p>
            <label style={{ display: "block", marginTop: "0.75rem", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              agent pubkey
              <input
                value={agentInput}
                onChange={(e) => setAgentInput(e.target.value)}
                placeholder="base58 pubkey"
                className="input"
                style={{ marginTop: "0.25rem" }}
              />
            </label>
            <label style={{ display: "block", marginTop: "0.5rem", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
              new policy root (hex)
              <input
                value={rootInput}
                onChange={(e) => setRootInput(e.target.value)}
                placeholder="64 hex chars"
                className="input"
                style={{ marginTop: "0.25rem" }}
              />
            </label>
            {errorMsg && (
              <div style={{ marginTop: "0.5rem", color: "var(--accent-red)", fontSize: "0.75rem" }}>
                {errorMsg}
              </div>
            )}
            {busyMsg && (
              <div style={{ marginTop: "0.5rem", color: "var(--accent-green)", fontSize: "0.75rem" }}>
                {busyMsg}
              </div>
            )}
            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                gap: "0.5rem",
                justifyContent: "flex-end",
              }}
            >
              <button onClick={() => setShowUpdate(false)} className="btn btn-ghost">
                cancel
              </button>
              <button
                onClick={() => approveAndUpdate(approval.id)}
                disabled={!!busyMsg}
                className="btn btn-primary"
              >
                sign &amp; broadcast
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Styles moved to globals.css — modal-overlay, modal-card, input, btn, btn-primary, btn-ghost
