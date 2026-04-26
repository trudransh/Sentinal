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
  error?: string;
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

  return (
    <div>
      <div style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
        Total ≈ ${totalUsd.toFixed(2)}
      </div>
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
                no balances reported
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
