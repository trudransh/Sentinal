"use client";

import { useEffect, useRef, useState } from "react";

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

interface HoverState {
  index: number;
  x: number;
  y: number;
}

export default function AgentSpendChart({
  address,
  days = 7,
}: {
  address: string;
  days?: number;
}) {
  const [data, setData] = useState<Response | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

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

  if (!data) {
    return (
      <div className="skeleton-stack">
        <div className="skeleton skeleton-row med" />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    );
  }
  if (data._stub) {
    return (
      <div className="empty-state">
        <span className="empty-glyph">∿</span>
        <span className="empty-title">spend chart unavailable</span>
        <span className="empty-hint">{data._stub}</span>
      </div>
    );
  }

  const points = data.days ?? [];
  const totalTx =
    data.totalTx ?? points.reduce((s, p) => s + p.txCount, 0);
  const totalNet = points.reduce((s, p) => s + p.netSol, 0);
  const maxAbs = Math.max(0.0001, ...points.map((p) => Math.abs(p.netSol)));

  const W = 600;
  const H = 140;
  const PAD_X = 24;
  const PAD_Y = 22;
  const stepX =
    points.length > 1 ? (W - 2 * PAD_X) / (points.length - 1) : 0;
  const yMid = H / 2;
  const yScale = H / 2 - PAD_Y;

  const xy = (i: number, p: DayPoint) => ({
    x: PAD_X + i * stepX,
    y: yMid - (p.netSol / maxAbs) * yScale,
  });

  const linePoints = points.map((p, i) => xy(i, p));
  const polylineStr = linePoints.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");

  // Build smooth area: from first point along the curve to the baseline.
  const areaPath = (() => {
    if (linePoints.length === 0) return "";
    const head = linePoints[0]!;
    const segs = linePoints
      .map((pt) => `L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(" ");
    const tail = linePoints[linePoints.length - 1]!;
    return `M ${head.x.toFixed(1)} ${yMid.toFixed(1)} ${segs} L ${tail.x.toFixed(1)} ${yMid.toFixed(1)} Z`;
  })();

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const xCoord = xRatio * W;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < linePoints.length; i++) {
      const dx = Math.abs(linePoints[i]!.x - xCoord);
      if (dx < best) {
        best = dx;
        nearest = i;
      }
    }
    const pt = linePoints[nearest]!;
    setHover({
      index: nearest,
      x: (pt.x / W) * rect.width,
      y: (pt.y / H) * rect.height,
    });
  }

  return (
    <div>
      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--text-secondary)",
          marginBottom: "0.5rem",
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span>last {data.windowDays ?? days} days</span>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span style={{ color: "var(--text-primary)", fontFamily: "var(--font-mono)" }}>
          {totalTx} txs
        </span>
        <span style={{ color: "var(--text-muted)" }}>·</span>
        <span
          style={{
            color: totalNet >= 0 ? "var(--accent-green)" : "var(--accent-red)",
            fontFamily: "var(--font-mono)",
          }}
        >
          net {totalNet >= 0 ? "+" : ""}
          {totalNet.toFixed(4)} SOL
        </span>
        <SourceBadge src={data._source} cluster={data._cluster} />
      </div>
      <div
        className="chart-frame"
        style={{ position: "relative" }}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          ref={svgRef}
          width="100%"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ height: H, display: "block" }}
          onMouseMove={onMove}
        >
          <defs>
            <linearGradient id="spend-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.45" />
              <stop offset="60%" stopColor="#34d399" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="spend-line" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="50%" stopColor="#34d399" />
              <stop offset="100%" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          {/* Mid baseline */}
          <line
            x1={PAD_X}
            x2={W - PAD_X}
            y1={yMid}
            y2={yMid}
            stroke="var(--border-default)"
            strokeDasharray="2,4"
            strokeWidth={1}
          />
          {/* Bars (kept for absolute magnitude) */}
          {points.map((p, i) => {
            const { x } = xy(i, p);
            const h = Math.abs((p.netSol / maxAbs) * yScale);
            const y = p.netSol >= 0 ? yMid - h : yMid;
            return (
              <rect
                key={p.date}
                x={x - 4}
                y={y}
                width={8}
                height={Math.max(1, h)}
                fill={p.netSol >= 0 ? "#34d399" : "#f87171"}
                opacity={0.16}
                rx={1}
              />
            );
          })}
          {/* Area fill */}
          {areaPath && <path d={areaPath} fill="url(#spend-area)" />}
          {/* Trend line */}
          {linePoints.length > 1 && (
            <polyline
              points={polylineStr}
              fill="none"
              stroke="url(#spend-line)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {/* Date labels */}
          {points.map((p, i) => {
            if (
              i % Math.ceil(points.length / 4) !== 0 &&
              i !== points.length - 1
            )
              return null;
            const { x } = xy(i, p);
            return (
              <text
                key={`l-${p.date}`}
                x={x}
                y={H - 6}
                fontSize="9"
                fill="var(--text-muted)"
                textAnchor="middle"
              >
                {p.date.slice(5)}
              </text>
            );
          })}
          {/* Hover marker */}
          {hover && (
            <circle
              cx={linePoints[hover.index]!.x}
              cy={linePoints[hover.index]!.y}
              r={4}
              fill="var(--accent-blue)"
              stroke="white"
              strokeWidth={1.5}
            />
          )}
        </svg>
        {hover && points[hover.index] && (
          <div
            className="chart-tooltip"
            style={{ left: `${hover.x}px`, top: `${hover.y}px` }}
          >
            <div style={{ color: "var(--text-secondary)" }}>
              {points[hover.index]!.date}
            </div>
            <div
              style={{
                color:
                  points[hover.index]!.netSol >= 0
                    ? "var(--accent-green)"
                    : "var(--accent-red)",
              }}
            >
              {points[hover.index]!.netSol >= 0 ? "+" : ""}
              {points[hover.index]!.netSol.toFixed(4)} SOL
            </div>
            <div style={{ color: "var(--text-muted)" }}>
              {points[hover.index]!.txCount} tx
            </div>
          </div>
        )}
      </div>
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
