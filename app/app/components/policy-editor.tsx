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

export default function PolicyEditor() {
  const [yaml, setYaml] = useState<string>(DEFAULT_YAML);
  const [result, setResult] = useState<{ ok: true; rootHex: string } | { ok: false; error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function validate() {
    setBusy(true);
    try {
      const r = await fetch("/api/policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yaml }),
      });
      const data = (await r.json()) as { rootHex?: string; error?: string };
      if (r.ok && data.rootHex) setResult({ ok: true, rootHex: data.rootHex });
      else setResult({ ok: false, error: data.error ?? `HTTP ${r.status}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{
        height: 280,
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        overflow: "hidden",
      }}>
        <Monaco
          defaultLanguage="yaml"
          value={yaml}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 12.5,
            fontFamily: "var(--font-mono)",
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            padding: { top: 8 },
            renderLineHighlight: "none",
          }}
          onChange={(v) => setYaml(v ?? "")}
        />
      </div>
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={validate} disabled={busy} className="btn btn-primary">
          validate + compute root
        </button>
        {result?.ok === true && (
          <code style={{
            fontSize: "0.72rem",
            color: "var(--accent-green)",
            fontFamily: "var(--font-mono)",
            background: "var(--accent-green-dim)",
            padding: "0.2rem 0.5rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--accent-green-border)",
          }}>
            root: {result.rootHex.slice(0, 16)}…
          </code>
        )}
        {result?.ok === false && (
          <span style={{
            fontSize: "0.72rem",
            color: "var(--accent-red)",
            background: "var(--accent-red-dim)",
            padding: "0.2rem 0.5rem",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--accent-red-border)",
          }}>
            {result.error}
          </span>
        )}
      </div>
      <div style={{ marginTop: "0.5rem", fontSize: "0.68rem", color: "var(--text-muted)" }}>
        On-chain <code style={{ color: "var(--accent-blue)" }}>update_policy</code> is signed via the wallet flow above.
      </div>
    </div>
  );
}
