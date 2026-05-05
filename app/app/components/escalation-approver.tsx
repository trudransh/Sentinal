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

// HARDEN-7: dashboard token mirrors SENTINEL_DASHBOARD_TOKEN on the server.
// In dev, NEXT_PUBLIC_SENTINEL_DASHBOARD_TOKEN can be left blank if the
// server allows unauth dev mode; in prod, an unset token disables the
// approval flow entirely (the server returns 401).
const DASHBOARD_TOKEN = process.env.NEXT_PUBLIC_SENTINEL_DASHBOARD_TOKEN ?? "";

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
  // HARDEN-8: agent is bound to the escalation row, never typed by hand. The
  // operator only ever fills in YAML — root is computed by the validate
  // endpoint. This kills the confused-deputy attack where an attacker who
  // could inject an escalation also chose what root the operator's wallet
  // signed.
  const [yamlInput, setYamlInput] = useState("");
  const [validatedRoot, setValidatedRoot] = useState<string | null>(null);
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

  const dashboardHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (DASHBOARD_TOKEN) h["x-sentinel-token"] = DASHBOARD_TOKEN;
    return h;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/escalations", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as { escalations: EscalationRow[] };
      setPending(data.escalations ?? []);
    } catch {
      // Network blip — leave previous list in place; next tick retries.
    }
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
    const r = await fetch("/api/escalations", {
      method: "POST",
      headers: dashboardHeaders,
      body: JSON.stringify({ id, action }),
    });
    if (!r.ok) {
      setErrorMsg(`escalation ${action} failed (${r.status})`);
    }
    await refresh();
  }

  async function validateRoot() {
    setErrorMsg(null);
    setValidatedRoot(null);
    try {
      const r = await fetch("/api/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlInput }),
      });
      const j = (await r.json()) as { rootHex?: string; error?: string };
      if (!r.ok || !j.rootHex) {
        setErrorMsg(j.error ?? "policy validation failed");
        return;
      }
      setValidatedRoot(j.rootHex);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function approveAndUpdate(id: string, agentBase58: string) {
    setErrorMsg(null);
    if (!programPk) {
      setErrorMsg("SENTINEL_REGISTRY_PROGRAM_ID is not set");
      return;
    }
    if (!connected || !publicKey || !signTransaction) {
      setErrorMsg("connect a wallet first");
      return;
    }
    if (!validatedRoot) {
      setErrorMsg("paste new policy YAML and click Validate first");
      return;
    }

    let agentPk: PublicKey;
    try {
      agentPk = new PublicKey(agentBase58);
    } catch {
      setErrorMsg(`escalation row's agent pubkey is invalid: ${agentBase58}`);
      return;
    }

    const rootBytes = new Uint8Array(
      validatedRoot.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
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
      const r = await fetch("/api/escalations", {
        method: "POST",
        headers: dashboardHeaders,
        body: JSON.stringify({ id, action: "approve_and_update" }),
      });
      if (!r.ok) {
        setErrorMsg(`tx confirmed but server rejected resolve (${r.status})`);
      }
      setShowUpdate(false);
      setYamlInput("");
      setValidatedRoot(null);
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
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem", fontWeight: 600 }}>
              Approve &amp; update policy
            </h3>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: "0.8rem" }}>
              Wallet will sign an <code style={{ color: "var(--accent-blue)" }}>update_policy</code>
              ix on devnet for the agent below. Paste the new policy YAML; the
              server validates it and computes the canonical root — the operator
              never types raw hex.
            </p>
            <div
              style={{
                marginTop: "0.75rem",
                fontSize: "0.7rem",
                color: "var(--text-secondary)",
                fontFamily: "var(--font-mono, monospace)",
              }}
            >
              agent (locked from row): {approval.agent}
            </div>
            <label
              style={{
                display: "block",
                marginTop: "0.5rem",
                fontSize: "0.72rem",
                color: "var(--text-secondary)",
              }}
            >
              new policy YAML
              <textarea
                value={yamlInput}
                onChange={(e) => {
                  setYamlInput(e.target.value);
                  setValidatedRoot(null);
                }}
                rows={10}
                placeholder="version: 1\nagent: ...\ncaps:\n  - { token: SOL, max_per_tx: 0.5 }\n"
                className="input"
                style={{ marginTop: "0.25rem", fontFamily: "var(--font-mono, monospace)" }}
              />
            </label>
            {validatedRoot && (
              <div
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.7rem",
                  color: "var(--accent-green)",
                  fontFamily: "var(--font-mono, monospace)",
                  wordBreak: "break-all",
                }}
              >
                root: {validatedRoot}
              </div>
            )}
            {errorMsg && (
              <div
                style={{
                  marginTop: "0.5rem",
                  color: "var(--accent-red)",
                  fontSize: "0.75rem",
                }}
              >
                {errorMsg}
              </div>
            )}
            {busyMsg && (
              <div
                style={{
                  marginTop: "0.5rem",
                  color: "var(--accent-green)",
                  fontSize: "0.75rem",
                }}
              >
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
              <button
                onClick={() => {
                  setShowUpdate(false);
                  setYamlInput("");
                  setValidatedRoot(null);
                }}
                className="btn btn-ghost"
              >
                cancel
              </button>
              <button
                onClick={validateRoot}
                disabled={!yamlInput || !!busyMsg}
                className="btn btn-ghost"
              >
                validate
              </button>
              <button
                onClick={() => approveAndUpdate(approval.id, approval.agent)}
                disabled={!validatedRoot || !!busyMsg}
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
