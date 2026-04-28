"use client";

import { useEffect, useState } from "react";

interface DayPoint {
  date: string;
  netSol: number;
  txCount: number;
}

interface Response {
  days?: DayPoint[];
  _source?: "devnet-rpc" | "sim" | "stub" | "error";
  _cluster?: "devnet" | "mainnet" | "unknown";
  _stub?: string;
  totalTx?: number;
  windowDays?: number;
  error?: string;
}

export default function AgentSpendChart({ address, days = 7 }: { address: string; days?: number }) {
  const [data, setData] = useState<Response | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetch(
          `/api/agent-spend?address=${encodeURIComponent(address)}&days=${days}`,
          { cache: "no-store" },
        );
        const json = (await r.json()) as Response;
        if (!cancelled) setData(json);
      } catch {
        /* swallow */
      }
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [address, days]);

  if (!data) return <div style={{ opacity: 0.5 }}>loading…</div>;
  if (data._stub)
    return (
      <div style={{ opacity: 0.6, fontSize: "0.8rem" }}>
        spend chart unavailable ({data._stub})
      </div>
    );

  const points = data.days ?? [];
  const totalTx = data.totalTx ?? points.reduce((s, p) => s + p.txCount, 0);
  const totalNet = points.reduce((s, p) => s + p.netSol, 0);
  const max = Math.max(0.0001, ...points.map((p) => Math.abs(p.netSol)));

  const W = 600;
  const H = 120;
  const PAD = 24;
  const stepX = points.length > 1 ? (W - 2 * PAD) / (points.length - 1) : 0;
  const yMid = H / 2;

  const linePoints = points
    .map((p, i) => {
      const x = PAD + i * stepX;
      const y = yMid - (p.netSol / max) * (H / 2 - PAD);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div>
      <div style={{ fontSize: "0.75rem", opacity: 0.7, marginBottom: "0.5rem" }}>
        last {data.windowDays ?? days} days · {totalTx} txs · net{" "}
        {totalNet >= 0 ? "+" : ""}
        {totalNet.toFixed(4)} SOL
        <SourceBadge src={data._source} cluster={data._cluster} />
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ height: H }}>
        <rect x={0} y={0} width={W} height={H} rx={4} fill="#0f141b" />
        <line
          x1={PAD}
          x2={W - PAD}
          y1={yMid}
          y2={yMid}
          stroke="#1f242c"
          strokeDasharray="2,3"
        />
        {points.map((p, i) => {
          const x = PAD + i * stepX;
          const h = Math.abs((p.netSol / max) * (H / 2 - PAD));
          const y = p.netSol >= 0 ? yMid - h : yMid;
          return (
            <rect
              key={p.date}
              x={x - 4}
              y={y}
              width={8}
              height={Math.max(1, h)}
              fill={p.netSol >= 0 ? "#2a5" : "#933"}
              opacity={0.4}
            >
              <title>{`${p.date}: ${p.netSol >= 0 ? "+" : ""}${p.netSol.toFixed(4)} SOL · ${p.txCount} tx`}</title>
            </rect>
          );
        })}
        {points.length > 1 && (
          <polyline points={linePoints} fill="none" stroke="#9ee6b0" strokeWidth={1.5} />
        )}
        {points.map((p, i) => {
          if (i % Math.ceil(points.length / 4) !== 0 && i !== points.length - 1) return null;
          const x = PAD + i * stepX;
          return (
            <text
              key={`l-${p.date}`}
              x={x}
              y={H - 4}
              fontSize="9"
              fill="#6c7480"
              textAnchor="middle"
            >
              {p.date.slice(5)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function SourceBadge({
  src,
  cluster,
}: {
  src: Response["_source"];
  cluster: Response["_cluster"];
}) {
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
  const ok = src === "devnet-rpc" || src === "sim";
  return (
    <span
      style={{
        background: ok ? "#173" : "#222",
        color: ok ? "#dfe" : "#aaa",
        border: `1px solid ${ok ? "#2a5" : "#333"}`,
        padding: "0.05rem 0.35rem",
        borderRadius: 3,
        fontSize: "0.7rem",
        marginLeft: "0.5rem",
      }}
    >
      {label}
    </span>
  );
}
