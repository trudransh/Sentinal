"use client";

import { useEffect, useState } from "react";
import { useCountUp } from "../../lib/ui";

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

function SourceBadge({
  src,
  cluster,
}: {
  src: Response["_source"];
  cluster: Response["_cluster"];
}) {
  const klass =
    src === "devnet-rpc" || src === "sim"
      ? "live"
      : src === "error"
      ? "error"
      : "stub";
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
  return <span className={`source-badge ${klass}`}>{label}</span>;
}

function tokenGlyphClass(symbol: string | undefined): string {
  if (!symbol) return "";
  const k = symbol.toLowerCase();
  if (k === "sol") return "sol";
  if (k === "usdc") return "usdc";
  if (k === "usdt") return "usdt";
  if (k === "bonk") return "bonk";
  return "";
}

function tokenInitial(b: Balance): string {
  const s = b.symbol ?? b.name ?? b.address ?? "?";
  return s.slice(0, 1).toUpperCase();
}

export default function BalanceWidget({ address }: { address: string }) {
  const [data, setData] = useState<Response | null>(null);
  const totalUsdRaw = (data?.balances ?? []).reduce(
    (s, b) => s + (b.valueUsd ?? 0),
    0,
  );
  const totalUsd = useCountUp(totalUsdRaw);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch(
          `/api/balance?address=${encodeURIComponent(address)}`,
          { cache: "no-store" },
        );
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

  if (!data) {
    return (
      <div className="skeleton-stack">
        <div className="skeleton skeleton-row med" />
        <div className="skeleton" style={{ height: 36 }} />
        <div className="skeleton" style={{ height: 36 }} />
      </div>
    );
  }
  if (data._stub)
    return (
      <div className="empty-state">
        <span className="empty-glyph">$</span>
        <span className="empty-title">Dune SIM proxy not configured</span>
        <span className="empty-hint">{data._stub}</span>
      </div>
    );
  if (data.error)
    return (
      <div
        style={{
          color: "var(--accent-red)",
          fontSize: "0.8rem",
        }}
      >
        {data.error}
      </div>
    );

  const balances = (data.balances ?? []).slice(0, 5);
  const fb = data.webhookFallback;

  return (
    <div>
      <div className="stat-hero">
        <span className="stat-value-xl gradient-text count-up">
          ${totalUsd.toFixed(2)}
        </span>
        <SourceBadge src={data._source} cluster={data._cluster} />
      </div>
      <div className="stat-label">total estimated value</div>

      {fb && (
        <div
          style={{
            marginTop: "0.85rem",
            padding: "0.55rem 0.65rem",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            fontSize: "0.72rem",
            color: "var(--text-secondary)",
            background: "var(--bg-input)",
          }}
        >
          Live SIM returned no balances — showing webhook-derived activity. txs={fb.txCount},
          net SOL {fb.netSol >= 0 ? "+" : ""}
          {fb.netSol.toFixed(4)}
          {fb.lastSignature ? `, last=${short(fb.lastSignature)}` : ""}
          {data._fallbackOnly && data.fallbackReason
            ? ` (${data.fallbackReason})`
            : ""}
          {fb.recentDeltasSol.length > 1 && (
            <div style={{ marginTop: "0.4rem" }}>
              <Sparkline values={fb.recentDeltasSol} />
            </div>
          )}
        </div>
      )}

      <div className="token-grid" style={{ marginTop: "0.85rem" }}>
        {balances.length === 0 ? (
          <div className="empty-state" style={{ padding: "0.75rem" }}>
            <span className="empty-title">no token balances reported</span>
            <span className="empty-hint">
              SIM only indexes mainnet — devnet wallets always come back empty
            </span>
          </div>
        ) : (
          balances.map((b, i) => (
            <div className="token-row" key={i}>
              <span className={`token-glyph ${tokenGlyphClass(b.symbol)}`}>
                {tokenInitial(b)}
              </span>
              <div>
                <div className="token-symbol">
                  {b.symbol ?? b.name ?? "?"}
                </div>
                {b.name && b.symbol && b.name !== b.symbol && (
                  <div className="token-name">{b.name}</div>
                )}
              </div>
              <span className="token-amount">{b.amount ?? "—"}</span>
              <span className="token-usd">
                {b.valueUsd != null ? `$${b.valueUsd.toFixed(2)}` : "—"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function short(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function Sparkline({ values }: { values: number[] }) {
  const width = 220;
  const height = 36;
  const pad = 4;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0;
  const points = values
    .map((v, i) => {
      const x = pad + i * step;
      const y =
        height - pad - ((v - min) / span) * (height - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const isDown = values[values.length - 1]! < 0;
  const stroke = isDown ? "var(--accent-red)" : "var(--accent-green)";
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="spk-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.32" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        fill="url(#spk-fill)"
        points={`${pad},${height - pad} ${points} ${
          width - pad
        },${height - pad}`}
      />
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
