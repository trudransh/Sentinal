"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";

const UPDATE_POLICY_DISCRIMINATOR = new Uint8Array([
  212, 245, 246, 7, 163, 151, 18, 57,
]);

const DASHBOARD_TOKEN = process.env.NEXT_PUBLIC_SENTINEL_DASHBOARD_TOKEN ?? "";

// Custom event the EscalationQueue dispatches when the operator clicks
// "rotate policy on-chain" on a row. Carries the row's id + agent.
export interface RotatePolicyEvent {
  id: string;
  agent: string;
}

export const ROTATE_POLICY_EVENT = "sentinel:rotate-policy";

// EscalationApprover is now a *non-blocking* component. It does NOT auto-pop
// any modal on page load. It owns the on-chain `update_policy` flow and only
// opens its YAML modal when explicitly invoked via a `sentinel:rotate-policy`
// CustomEvent (dispatched by the inline EscalationQueue's "rotate" button).
//
// Approving/rejecting *off-chain* is fully handled by EscalationQueue. This
// component only exists for the one privileged action: rotate the on-chain
// policy root in the same step as approving the escalation.
export default function EscalationApprover({
  programId,
}: {
  programId: string | undefined;
}) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [active, setActive] = useState<RotatePolicyEvent | null>(null);
  const [yamlInput, setYamlInput] = useState("");
  const [validatedRoot, setValidatedRoot] = useState<string | null>(null);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

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

  // Listen for the custom event from EscalationQueue.
  useEffect(() => {
    function onRotate(e: Event) {
      const detail = (e as CustomEvent<RotatePolicyEvent>).detail;
      if (!detail) return;
      setActive(detail);
      setYamlInput("");
      setValidatedRoot(null);
      setUpdateError(null);
    }
    window.addEventListener(ROTATE_POLICY_EVENT, onRotate);
    return () => window.removeEventListener(ROTATE_POLICY_EVENT, onRotate);
  }, []);

  const close = useCallback(() => {
    setActive(null);
    setYamlInput("");
    setValidatedRoot(null);
    setUpdateError(null);
  }, []);

  async function validateRoot() {
    setUpdateError(null);
    setValidatedRoot(null);
    try {
      const r = await fetch("/api/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml: yamlInput }),
      });
      const j = (await r.json()) as { rootHex?: string; error?: string };
      if (!r.ok || !j.rootHex) {
        setUpdateError(j.error ?? "policy validation failed");
        return;
      }
      setValidatedRoot(j.rootHex);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
    }
  }

  async function approveAndUpdate() {
    if (!active) return;
    setUpdateError(null);
    if (!programPk) {
      setUpdateError(
        "SENTINEL_REGISTRY_PROGRAM_ID is not set — check your .env file.",
      );
      return;
    }
    if (!connected || !publicKey || !signTransaction) {
      setUpdateError(
        "No wallet connected. Click the wallet button in the sidebar to connect Phantom first.",
      );
      return;
    }
    if (!validatedRoot) {
      setUpdateError("Paste your new policy YAML and click 'validate' first.");
      return;
    }

    let agentPk: PublicKey;
    try {
      agentPk = new PublicKey(active.agent);
    } catch {
      setUpdateError(`Agent pubkey is invalid: ${active.agent}`);
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

    setBusyMsg("requesting Phantom signature…");
    try {
      const tx = new Transaction().add(ix);
      tx.feePayer = publicKey;
      tx.recentBlockhash = (
        await connection.getLatestBlockhash("confirmed")
      ).blockhash;
      const signed = await signTransaction(tx);
      setBusyMsg("broadcasting to devnet…");
      const sig = await connection.sendRawTransaction(signed.serialize());
      setBusyMsg(`confirming ${sig.slice(0, 8)}…`);
      await connection.confirmTransaction(sig, "confirmed");
      setBusyMsg(`on-chain confirmed ✓ ${sig.slice(0, 8)}`);
      const r = await fetch("/api/escalations", {
        method: "POST",
        headers: dashboardHeaders,
        body: JSON.stringify({ id: active.id, action: "approve_and_update" }),
      });
      if (!r.ok) {
        setUpdateError(
          `Transaction confirmed on-chain but server returned ${r.status} — escalation status may be stale.`,
        );
      } else {
        close();
      }
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => setBusyMsg(null), 6000);
    }
  }

  if (!active) return null;

  return (
    <div className="modal-overlay" onClick={close}>
      <div
        className="modal-card"
        style={{ maxWidth: 540, width: "92vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            marginBottom: "0.75rem",
          }}
        >
          <span className="status-pill escalate" style={{ fontSize: "0.6rem" }}>
            <span className="pill-dot" />
            approve + rotate policy
          </span>
        </div>

        <h3 style={{ margin: "0 0 0.4rem 0", fontSize: "1.05rem", fontWeight: 600 }}>
          Approve &amp; rotate on-chain policy
        </h3>
        <p
          style={{
            margin: "0 0 0.75rem 0",
            color: "var(--text-secondary)",
            fontSize: "0.78rem",
            lineHeight: 1.55,
          }}
        >
          Clicking <strong>sign &amp; broadcast</strong> signs an{" "}
          <code style={{ color: "var(--accent-blue)" }}>update_policy</code>{" "}
          instruction on Solana devnet with your connected Phantom wallet. The
          new policy YAML you paste here gets hashed to a 32-byte root — that
          root is what goes on-chain, not the YAML itself.
        </p>

        <div
          style={{
            padding: "0.45rem 0.6rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid",
            fontSize: "0.72rem",
            marginBottom: "0.75rem",
            borderColor: connected
              ? "var(--accent-green-border)"
              : "rgba(251,191,36,0.3)",
            background: connected
              ? "var(--accent-green-dim)"
              : "var(--accent-yellow-dim)",
            color: connected ? "var(--accent-green)" : "var(--accent-yellow)",
          }}
        >
          {connected
            ? `✓ Wallet connected: ${publicKey?.toBase58().slice(0, 8)}…`
            : "⚠ No wallet connected — close this modal, click the wallet button in the sidebar, then re-open."}
        </div>

        <div
          style={{
            marginBottom: "0.5rem",
            fontSize: "0.7rem",
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
          }}
        >
          agent:{" "}
          <span style={{ color: "var(--text-secondary)" }}>{active.agent}</span>
        </div>

        <label
          style={{
            display: "block",
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
            rows={9}
            placeholder={
              "version: 1\nagent: " +
              active.agent +
              "\ncaps:\n  - token: USDC\n    max_per_tx: 10\n    max_per_day: 50\nrate_limit:\n  max_tx_per_minute: 6\n"
            }
            className="input"
            style={{
              marginTop: "0.25rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.78rem",
              display: "block",
              width: "100%",
              boxSizing: "border-box",
            }}
          />
        </label>

        {validatedRoot && (
          <div
            style={{
              marginTop: "0.5rem",
              fontSize: "0.68rem",
              color: "var(--accent-green)",
              fontFamily: "var(--font-mono)",
              wordBreak: "break-all",
            }}
          >
            ✓ root: {validatedRoot}
          </div>
        )}

        {updateError && (
          <div
            className="status-pill deny"
            style={{
              marginTop: "0.6rem",
              fontSize: "0.72rem",
              alignItems: "flex-start",
            }}
          >
            <span className="pill-dot" style={{ flexShrink: 0, marginTop: "0.15rem" }} />
            {updateError}
          </div>
        )}
        {busyMsg && (
          <div
            className="status-pill info"
            style={{ marginTop: "0.6rem", fontSize: "0.72rem" }}
          >
            <span className="pill-dot" />
            {busyMsg}
          </div>
        )}

        <div
          style={{
            marginTop: "1rem",
            display: "flex",
            gap: "0.5rem",
            justifyContent: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <button onClick={close} className="btn btn-ghost">
            cancel
          </button>
          <button
            onClick={validateRoot}
            disabled={!yamlInput || !!busyMsg}
            className="btn btn-ghost"
          >
            validate YAML
          </button>
          <button
            onClick={approveAndUpdate}
            disabled={!validatedRoot || !!busyMsg || !connected}
            className="btn btn-primary"
            title={!connected ? "connect Phantom first" : undefined}
          >
            sign &amp; broadcast
          </button>
        </div>
      </div>
    </div>
  );
}
