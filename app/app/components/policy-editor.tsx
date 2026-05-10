"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const DEFAULT_YAML = `version: 1
agent: AGENTPubKEy11111111111111111111111111111111
caps:
  - token: USDC
    max_per_tx: 10
    max_per_day: 50
allowlist:
  destinations:
    - DexRouter11111111111111111111111111111111111
rate_limit:
  max_tx_per_minute: 6
`;

type ValidationState =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "ok"; rootHex: string }
  | { kind: "err"; error: string };

export default function PolicyEditor() {
  const [yaml, setYaml] = useState<string>(DEFAULT_YAML);
  const [state, setState] = useState<ValidationState>({ kind: "idle" });

  async function validate() {
    setState({ kind: "validating" });
    try {
      const r = await fetch("/api/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml }),
      });
      const data = (await r.json()) as { rootHex?: string; error?: string };
      if (r.ok && data.rootHex) {
        setState({ kind: "ok", rootHex: data.rootHex });
      } else {
        setState({ kind: "err", error: data.error ?? `HTTP ${r.status}` });
      }
    } catch (err) {
      setState({
        kind: "err",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function reset() {
    setYaml(DEFAULT_YAML);
    setState({ kind: "idle" });
  }

  function copyRoot() {
    if (state.kind !== "ok") return;
    navigator.clipboard.writeText(state.rootHex).catch(() => {});
  }

  return (
    <div>
      <div className="editor-toolbar">
        <button
          onClick={validate}
          className="btn btn-primary"
          disabled={state.kind === "validating"}
        >
          {state.kind === "validating" ? "validating…" : "validate"}
        </button>
        <button onClick={reset} className="btn btn-ghost">
          reset
        </button>
        <div className="toolbar-spacer" />
        <ValidationPill state={state} onCopy={copyRoot} />
      </div>
      <div className="editor-frame" style={{ height: 280 }}>
        <Monaco
          defaultLanguage="yaml"
          value={yaml}
          theme="vs-dark"
          height="100%"
          options={{
            minimap: { enabled: false },
            fontSize: 12.5,
            fontFamily: "var(--font-mono)",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            padding: { top: 8 },
            renderLineHighlight: "none",
          }}
          onChange={(v) => {
            setYaml(v ?? "");
            if (state.kind !== "idle") setState({ kind: "idle" });
          }}
        />
      </div>
      <div
        style={{
          marginTop: "0.6rem",
          fontSize: "0.7rem",
          color: "var(--text-muted)",
        }}
      >
        On-chain <code style={{ color: "var(--accent-blue)" }}>update_policy</code>{" "}
        is signed via the wallet flow above. Squads-multisig owners use the{" "}
        <em style={{ fontStyle: "normal", color: "var(--text-secondary)" }}>
          Squads multisig owner
        </em>{" "}
        card below.
      </div>
    </div>
  );
}

function ValidationPill({
  state,
  onCopy,
}: {
  state: ValidationState;
  onCopy: () => void;
}) {
  if (state.kind === "idle") {
    return (
      <span className="status-pill muted">
        <span className="pill-dot" />
        unsaved
      </span>
    );
  }
  if (state.kind === "validating") {
    return (
      <span className="status-pill info">
        <span className="pill-dot" />
        validating
      </span>
    );
  }
  if (state.kind === "ok") {
    return (
      <button
        onClick={onCopy}
        className="status-pill allow"
        title="click to copy"
        style={{ cursor: "pointer", border: "none" }}
      >
        <span className="pill-dot" />
        root: {state.rootHex.slice(0, 8)}…{state.rootHex.slice(-4)}
      </button>
    );
  }
  return (
    <span className="status-pill deny" title={state.error}>
      <span className="pill-dot" />
      {state.error.length > 32 ? `${state.error.slice(0, 32)}…` : state.error}
    </span>
  );
}
