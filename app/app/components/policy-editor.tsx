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
      <div style={{ height: 320, border: "1px solid #1f242c", borderRadius: 4, overflow: "hidden" }}>
        <Monaco
          defaultLanguage="yaml"
          value={yaml}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
          }}
          onChange={(v) => setYaml(v ?? "")}
        />
      </div>
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <button onClick={validate} disabled={busy} style={btn}>
          validate + compute root
        </button>
        {result?.ok === true && (
          <code style={{ fontSize: "0.75rem", opacity: 0.85 }}>root: {result.rootHex}</code>
        )}
        {result?.ok === false && (
          <span style={{ fontSize: "0.75rem", color: "#f88" }}>{result.error}</span>
        )}
      </div>
      <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", opacity: 0.6 }}>
        Submitting `update_policy` on-chain happens in the operator wallet flow, not the dashboard.
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.8rem",
  padding: "0.4rem 0.8rem",
  borderRadius: 3,
  border: "1px solid #2a5",
  background: "#173",
  color: "#dfe",
  cursor: "pointer",
};
