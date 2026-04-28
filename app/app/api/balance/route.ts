import { NextResponse } from "next/server";
import { fetchBalances } from "@/lib/balance";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

interface WebhookFallback {
  source: "webhook";
  txCount: number;
  netSol: number;
  lastSignature: string | null;
  recentDeltasSol: number[];
}

function buildWebhookFallback(address: string): WebhookFallback | null {
  const db = getDb();
  const rows = db
    .prepare("SELECT signature, payload FROM policy_events ORDER BY received_at DESC LIMIT 200")
    .all() as Array<{ signature: string | null; payload: string }>;

  let txCount = 0;
  let netLamports = 0;
  let lastSignature: string | null = null;
  const deltasLamports: number[] = [];

  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.payload) as {
        feePayer?: string;
        accountData?: Array<{ account?: string; nativeBalanceChange?: number }>;
      };
      const mine = parsed.accountData?.find((a) => a.account === address);
      const touched = parsed.feePayer === address || Boolean(mine);
      if (!touched) continue;
      txCount += 1;
      const deltaLamports = mine?.nativeBalanceChange ?? 0;
      netLamports += deltaLamports;
      deltasLamports.push(deltaLamports);
      if (!lastSignature && row.signature) lastSignature = row.signature;
    } catch {
      // Ignore malformed payload rows and continue scanning.
    }
  }

  if (txCount === 0) return null;
  return {
    source: "webhook",
    txCount,
    netSol: netLamports / 1_000_000_000,
    lastSignature,
    recentDeltasSol: deltasLamports
      .slice(0, 20)
      .reverse()
      .map((v) => v / 1_000_000_000),
  };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "missing address" }, { status: 400 });
  }
  const fallback = buildWebhookFallback(address);
  try {
    const data = await fetchBalances(address);
    const balances = Array.isArray(data.balances) ? data.balances : [];
    const out = { ...data, webhookFallback: balances.length === 0 ? fallback : null };
    return NextResponse.json(out);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (fallback) {
      return NextResponse.json({
        balances: [],
        _fallbackOnly: true,
        fallbackReason: message,
        webhookFallback: fallback,
      });
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
