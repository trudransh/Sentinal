"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, type VersionedTransaction } from "@solana/web3.js";
import {
  buildSquadsBundle,
  buildSquadsExecuteTx,
  buildUpdatePolicyIx,
  fetchMultisigSnapshot,
  findPolicyPda,
  getSentinelVaultPda,
  type MultisigSnapshot,
} from "@sentinel/signer-shim/squads-owner";

// Phase 7 — compose Sentinel with Squads. The connected wallet member proposes
// an `update_policy` ix as a Squads vault transaction; threshold-many members
// approve; any member executes. Sentinel itself never changes — the registry
// only sees the vault PDA as `owner`, and `has_one = owner` works the same as
// for a personal keypair.

interface SquadsConnectProps {
  programId: string | undefined;
  defaultAgent: string;
}

const short = (s: string): string =>
  s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-6)}` : s;

export default function SquadsConnect({ programId, defaultAgent }: SquadsConnectProps) {
  const { publicKey, signTransaction, connected } = useWallet();
  const { connection } = useConnection();

  const [multisigInput, setMultisigInput] = useState("");
  const [snapshot, setSnapshot] = useState<MultisigSnapshot | null>(null);
  const [agentInput, setAgentInput] = useState(defaultAgent);
  const [yamlInput, setYamlInput] = useState("");
  const [validatedRoot, setValidatedRoot] = useState<string | null>(null);
  const [busyMsg, setBusyMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingIndex, setPendingIndex] = useState<bigint | null>(null);

  const programPk = useMemo(() => {
    if (!programId) return null;
    try {
      return new PublicKey(programId);
    } catch {
      return null;
    }
  }, [programId]);

  const multisigPk = useMemo(() => {
    try {
      return multisigInput ? new PublicKey(multisigInput) : null;
    } catch {
      return null;
    }
  }, [multisigInput]);

  const loadMultisig = useCallback(async () => {
    if (!multisigPk) {
      setErrorMsg("invalid multisig pubkey");
      return;
    }
    setErrorMsg(null);
    try {
      const snap = await fetchMultisigSnapshot(connection, multisigPk);
      setSnapshot(snap);
    } catch (err) {
      setSnapshot(null);
      setErrorMsg(
        `failed to load multisig: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [connection, multisigPk]);

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

  async function signAndSend(tx: VersionedTransaction, label: string) {
    if (!signTransaction) throw new Error("wallet does not support signing");
    setBusyMsg(`${label}: requesting signature…`);
    const signed = await signTransaction(tx);
    setBusyMsg(`${label}: broadcasting…`);
    const sig = await connection.sendRawTransaction(signed.serialize());
    setBusyMsg(`${label}: confirming ${sig.slice(0, 8)}…`);
    await connection.confirmTransaction(sig, "confirmed");
    return sig;
  }

  async function proposeUpdate() {
    setErrorMsg(null);
    if (!programPk || !snapshot || !multisigPk) {
      setErrorMsg("load a multisig first");
      return;
    }
    if (!connected || !publicKey || !signTransaction) {
      setErrorMsg("connect a wallet that's a member of the multisig");
      return;
    }
    if (!validatedRoot) {
      setErrorMsg("paste new policy YAML and click validate first");
      return;
    }
    let agentPk: PublicKey;
    try {
      agentPk = new PublicKey(agentInput);
    } catch {
      setErrorMsg(`invalid agent pubkey: ${agentInput}`);
      return;
    }

    const isMember = snapshot.members.some((m: PublicKey) => m.equals(publicKey));
    if (!isMember) {
      setErrorMsg(
        `connected wallet ${short(publicKey.toBase58())} is not a member of this multisig`,
      );
      return;
    }

    const rootBytes = new Uint8Array(
      validatedRoot.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );
    const innerInstruction = buildUpdatePolicyIx({
      programId: programPk,
      owner: snapshot.vaultPda,
      agent: agentPk,
      newRoot: rootBytes,
    });

    try {
      const bundle = await buildSquadsBundle({
        connection,
        vaultPda: snapshot.vaultPda,
        innerInstruction,
        snapshot,
        creator: publicKey,
        approvers: [publicKey],
      });
      await signAndSend(bundle.createTx, "vaultTransactionCreate");
      await signAndSend(bundle.proposeTx, "proposalCreate");
      // First member also approves up-front; remaining approvals happen in
      // the Squads UI (or via members hitting `Approve` here once polished).
      const firstApprove = bundle.approveTxs[0];
      if (firstApprove) {
        await signAndSend(firstApprove, "proposalApprove");
      }
      setPendingIndex(bundle.transactionIndex);
      setBusyMsg(
        `proposed at index ${bundle.transactionIndex}; ${snapshot.threshold - 1} more approval(s) required before execute`,
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }

  async function executeProposal() {
    setErrorMsg(null);
    if (!multisigPk || pendingIndex === null) {
      setErrorMsg("propose an update first");
      return;
    }
    if (!connected || !publicKey || !signTransaction) {
      setErrorMsg("connect a wallet to execute");
      return;
    }
    try {
      const executeTx = await buildSquadsExecuteTx({
        connection,
        multisigPda: multisigPk,
        transactionIndex: pendingIndex,
        executor: publicKey,
      });
      const sig = await signAndSend(executeTx, "vaultTransactionExecute");
      setBusyMsg(`executed ${sig}`);
      // Refresh snapshot so the UI shows the new transactionIndex.
      await loadMultisig();
      setPendingIndex(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => setBusyMsg(null), 6000);
    }
  }

  // Periodic refresh while a multisig is loaded so the UI reflects approvals
  // happening in the Squads web app.
  useEffect(() => {
    if (!multisigPk) return;
    const id = setInterval(() => {
      void loadMultisig();
    }, 4000);
    return () => clearInterval(id);
  }, [multisigPk, loadMultisig]);

  const policyPda = useMemo(() => {
    if (!programPk) return null;
    try {
      return findPolicyPda(programPk, new PublicKey(agentInput));
    } catch {
      return null;
    }
  }, [programPk, agentInput]);

  return (
    <div>
      <p
        style={{
          margin: "0 0 0.85rem 0",
          fontSize: "0.78rem",
          color: "var(--text-secondary)",
          lineHeight: 1.55,
        }}
      >
        When <code style={{ color: "var(--accent-blue)" }}>policy.owner</code>{" "}
        is a Squads vault PDA, every <code>update_policy</code> requires
        threshold-many member approvals. Sentinel itself doesn&apos;t change —{" "}
        <code>has_one = owner</code> resolves the multisig vault directly.
      </p>

      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          className="input"
          placeholder="multisig PDA (base58)"
          value={multisigInput}
          onChange={(e) => setMultisigInput(e.target.value.trim())}
          style={{
            flex: "1 1 280px",
            fontFamily: "var(--font-mono)",
            fontSize: "0.78rem",
          }}
        />
        <button
          onClick={loadMultisig}
          disabled={!multisigPk}
          className="btn btn-ghost"
        >
          load multisig
        </button>
      </div>

      {snapshot && (
        <div
          style={{
            marginTop: "0.85rem",
            padding: "0.9rem",
            background: "var(--bg-input)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              marginBottom: "0.6rem",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontSize: "0.65rem",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
              }}
            >
              threshold
            </span>
            <span
              style={{
                fontSize: "0.95rem",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
              }}
            >
              {snapshot.threshold} of {snapshot.members.length}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.7rem" }}>
              · tx index{" "}
              <code style={{ color: "var(--text-secondary)" }}>
                {snapshot.currentTransactionIndex.toString()}
              </code>
            </span>
          </div>
          <div className="threshold-bar" aria-hidden>
            <div
              className="threshold-fill"
              style={{
                width: `${
                  (snapshot.threshold / Math.max(1, snapshot.members.length)) *
                  100
                }%`,
              }}
            />
          </div>

          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35rem",
              marginTop: "0.85rem",
            }}
          >
            {snapshot.members.map((m: PublicKey) => {
              const isYou = !!publicKey && m.equals(publicKey);
              const initial = m.toBase58().slice(0, 1).toUpperCase();
              return (
                <span
                  key={m.toBase58()}
                  className={`member-chip ${isYou ? "you" : ""}`}
                  title={m.toBase58()}
                >
                  <span className="member-avatar">{initial}</span>
                  {short(m.toBase58())}
                  {isYou && (
                    <span
                      style={{
                        fontSize: "0.55rem",
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      you
                    </span>
                  )}
                </span>
              );
            })}
          </div>

          <div
            style={{
              marginTop: "0.85rem",
              fontSize: "0.68rem",
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
              wordBreak: "break-all",
            }}
            title={snapshot.vaultPda.toBase58()}
          >
            vault PDA: {snapshot.vaultPda.toBase58()}
          </div>
        </div>
      )}

      {snapshot && (
        <div style={{ marginTop: "0.75rem", display: "grid", gap: "0.5rem" }}>
          <input
            className="input"
            placeholder="agent pubkey"
            value={agentInput}
            onChange={(e) => setAgentInput(e.target.value.trim())}
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}
          />
          {policyPda && (
            <div
              style={{
                fontSize: "0.68rem",
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
              }}
            >
              policy PDA: {short(policyPda.toBase58())}
            </div>
          )}
          <textarea
            className="input"
            rows={6}
            value={yamlInput}
            onChange={(e) => {
              setYamlInput(e.target.value);
              setValidatedRoot(null);
            }}
            placeholder="new policy YAML"
            style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}
          />
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button onClick={validateRoot} disabled={!yamlInput} className="btn btn-ghost">
              validate
            </button>
            <button
              onClick={proposeUpdate}
              disabled={!validatedRoot || !!busyMsg}
              className="btn btn-primary"
            >
              propose update via Squads
            </button>
            {pendingIndex !== null && (
              <button
                onClick={executeProposal}
                disabled={!!busyMsg}
                className="btn btn-primary"
              >
                execute (tx {pendingIndex.toString()})
              </button>
            )}
          </div>
          {validatedRoot && (
            <div
              style={{
                fontSize: "0.7rem",
                color: "var(--accent-green)",
                fontFamily: "var(--font-mono)",
                wordBreak: "break-all",
              }}
            >
              root: {validatedRoot}
            </div>
          )}
        </div>
      )}

      {busyMsg && (
        <div
          className="status-pill info"
          style={{ marginTop: "0.85rem" }}
        >
          <span className="pill-dot" />
          {busyMsg}
        </div>
      )}
      {errorMsg && (
        <div
          className="status-pill deny"
          style={{ marginTop: "0.85rem" }}
        >
          <span className="pill-dot" />
          {errorMsg}
        </div>
      )}
    </div>
  );
}
