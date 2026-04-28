"use client";

import { useEffect, useState } from "react";

interface Balance {
  symbol?: string;
  name?: string;
  amount?: string;
  decimals?: number;
  valueUsd?: number;
  address?: string;
}

interface Response {
  balances?: Balance[];
  _stub?: string;
  _source?: "devnet-rpc" | "sim" | "stub" | "error";
  _cluster?: "devnet" | "mainnet" | "unknown";
  _fallbackOnly?: boolean;
  fallbackReason?: string;
  webhookFallback?: {
    source: "webhook";
    txCount: number;
    netSol: number;
    lastSignature: string | null;
    recentDeltasSol: number[];
  } | null;
  error?: string;
}

function sourceBadge(src: Response["_source"], cluster: Response["_cluster"]) {
  const label =
    src === "devnet-rpc"
      ? "live · devnet RPC"
      : src === "sim"
        ? `live · Dune SIM (${cluster ?? "?"})`
        : src === "stub"
          ? "stub"
          : src === "error"
            ? "error"
            : "—";
  const color =
    src === "devnet-rpc" || src === "sim"
      ? { bg: "#173", fg: "#dfe", border: "#2a5" }
      : src === "error"
        ? { bg: "#511", fg: "#fee", border: "#933" }
        : { bg: "#222", fg: "#aaa", border: "#333" };
  return (
    <span
      style={{
        background: color.bg,
        color: color.fg,
        border: `1px solid ${color.border}`,
        padding: "0.1rem 0.4rem",
        borderRadius: 3,
        fontSize: "0.7rem",
        marginLeft: "0.5rem",
      }}
    >
      {label}
    </span>
  );
}

export default function BalanceWidget({ address }: { address: string }) {
  const [data, setData] = useState<Response | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch(`/api/balance?address=${encodeURIComponent(address)}`, {
          cache: "no-store",
        });
        const json = (await r.json()) as Response;
        if (!cancelled) setData(json);
      } catch {
        /* swallow */
      }
    }
    tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address]);

  if (!data) return <div style={{ opacity: 0.5 }}>loading…</div>;
  if (data._stub)
    return (
      <div style={{ opacity: 0.6, fontSize: "0.8rem" }}>
        Dune SIM proxy not configured ({data._stub})
      </div>
    );
  if (data.error)
    return <div style={{ color: "#f88", fontSize: "0.8rem" }}>{data.error}</div>;

  const balances = (data.balances ?? []).slice(0, 5);
  const totalUsd = balances.reduce((s, b) => s + (b.valueUsd ?? 0), 0);
  const fb = data.webhookFallback;

  return (
    <div>
      <div style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
        Total ≈ ${totalUsd.toFixed(2)}
        {sourceBadge(data._source, data._cluster)}
      </div>
      {fb && (
        <div
          style={{
            marginBottom: "0.75rem",
            padding: "0.5rem",
            border: "1px solid #2b3440",
            borderRadius: 6,
            fontSize: "0.75rem",
            color: "#b8c7da",
            background: "#141a22",
          }}
        >
          Live SIM returned no balances; showing webhook-derived activity. txs={fb.txCount}, net SOL=
          {fb.netSol >= 0 ? "+" : ""}
          {fb.netSol.toFixed(4)}
          {fb.lastSignature ? `, last=${short(fb.lastSignature)}` : ""}
          {data._fallbackOnly && data.fallbackReason ? ` (${data.fallbackReason})` : ""}
          {fb.recentDeltasSol.length > 1 ? (
            <div style={{ marginTop: "0.4rem" }}>
              <Sparkline values={fb.recentDeltasSol} />
            </div>
          ) : null}
        </div>
      )}
      <table style={{ width: "100%", fontSize: "0.8rem" }}>
        <thead>
          <tr style={{ textAlign: "left", opacity: 0.6 }}>
            <th>token</th>
            <th>amount</th>
            <th>$</th>
          </tr>
        </thead>
        <tbody>
          {balances.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ opacity: 0.5 }}>
                no token balances reported
              </td>
            </tr>
          ) : (
            balances.map((b, i) => (
              <tr key={i} style={{ borderTop: "1px solid #1f242c" }}>
                <td>{b.symbol ?? b.name ?? b.address ?? "?"}</td>
                <td>{b.amount ?? "—"}</td>
                <td>{b.valueUsd != null ? `$${b.valueUsd.toFixed(2)}` : "—"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function short(s: string) {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function Sparkline({ values }: { values: number[] }) {
  const width = 220;
  const height = 44;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y = height - pad - ((v - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const isDown = values[values.length - 1]! < 0;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <rect x={0} y={0} width={width} height={height} rx={4} fill="#0f141b" />
      <polyline
        fill="none"
        stroke={isDown ? "#ff9e9e" : "#9ee6b0"}
        strokeWidth={2}
        points={points}
      />
    </svg>
  );
}
