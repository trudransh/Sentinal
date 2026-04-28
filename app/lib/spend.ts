// B3: agent spend over 7d. Cluster-aware like balance.ts — devnet uses
// getSignaturesForAddress + getParsedTransactions to compute lamport deltas
// per day; mainnet would use SIM /svm/transactions (mainnet-only indexer).

import { Connection, PublicKey } from "@solana/web3.js";

import { resolveRpcUrl, detectClusterFromUrl } from "./rpc";

export type SpendSource = "devnet-rpc" | "sim" | "stub" | "error";

export interface DayPoint {
  date: string;          // YYYY-MM-DD UTC
  netSol: number;        // signed; negative = outflow
  txCount: number;
}

export interface SpendResponse {
  days: DayPoint[];
  _source: SpendSource;
  _cluster: "devnet" | "mainnet" | "unknown";
  _stub?: string;
  totalTx?: number;
  windowDays?: number;
}

interface CacheEntry {
  fetchedAt: number;
  payload: SpendResponse;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function dayKey(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

async function fetchDevnet(
  address: string,
  rpcUrl: string,
  windowDays: number,
): Promise<SpendResponse> {
  const conn = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(address);

  const sigs = await conn.getSignaturesForAddress(owner, { limit: 100 });
  const cutoff = Math.floor(Date.now() / 1000) - windowDays * 86400;
  const inWindow = sigs.filter((s) => (s.blockTime ?? 0) >= cutoff);

  // Initialize the days array so empty days still render.
  const today = new Date();
  const dayMap = new Map<string, DayPoint>();
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    dayMap.set(key, { date: key, netSol: 0, txCount: 0 });
  }

  // Cap at 25. Helius free tier rejects batch RPC (`getParsedTransactions(sigs[])`
  // returns 403), so we fan out individual `getParsedTransaction` calls with a
  // small concurrency window to stay polite on the per-second rate limit.
  const slice = inWindow.slice(0, 25);
  const CONCURRENCY = 4;
  const results: Array<{ tx: Awaited<ReturnType<Connection["getParsedTransaction"]>>; sig: typeof slice[number] }> = [];
  for (let i = 0; i < slice.length; i += CONCURRENCY) {
    const chunk = slice.slice(i, i + CONCURRENCY);
    const fetched = await Promise.all(
      chunk.map(async (s) => {
        try {
          const tx = await conn.getParsedTransaction(s.signature, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          });
          return { tx, sig: s };
        } catch {
          return { tx: null, sig: s };
        }
      }),
    );
    results.push(...fetched);
  }

  for (const { tx, sig } of results) {
    if (!tx || !sig?.blockTime) continue;
    const keys = tx.transaction.message.accountKeys;
    const ownerIdx = keys.findIndex((k) => k.pubkey.toBase58() === address);
    if (ownerIdx < 0) continue;
    const pre = tx.meta?.preBalances?.[ownerIdx] ?? 0;
    const post = tx.meta?.postBalances?.[ownerIdx] ?? 0;
    const deltaLamports = post - pre;
    const key = dayKey(sig.blockTime);
    const cur = dayMap.get(key) ?? { date: key, netSol: 0, txCount: 0 };
    cur.netSol += deltaLamports / 1_000_000_000;
    cur.txCount += 1;
    dayMap.set(key, cur);
  }

  const days = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  return {
    days,
    _source: "devnet-rpc",
    _cluster: "devnet",
    totalTx: inWindow.length,
    windowDays,
  };
}

export async function fetchSpend(address: string, windowDays = 7): Promise<SpendResponse> {
  const cacheKey = `${address}:${windowDays}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) return cached.payload;

  const rpcUrl = resolveRpcUrl();
  const cluster = detectClusterFromUrl(rpcUrl);

  let payload: SpendResponse;
  try {
    if (cluster === "devnet") {
      payload = await fetchDevnet(address, rpcUrl, windowDays);
    } else {
      // Mainnet path through SIM is not wired in this minimal slice — Sentinel's
      // demo agent runs on devnet. For a mainnet showcase, plug @/lib/balance's
      // SIM call here against /v1/svm/transactions.
      payload = {
        days: [],
        _source: "stub",
        _cluster: cluster,
        _stub: "mainnet spend via SIM /svm/transactions not implemented",
      };
    }
  } catch (err) {
    payload = {
      days: [],
      _source: "error",
      _cluster: cluster,
      _stub: err instanceof Error ? err.message : String(err),
    };
  }

  cache.set(cacheKey, { fetchedAt: now, payload });
  return payload;
}
