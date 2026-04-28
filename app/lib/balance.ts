// A6 fix: Dune SIM only indexes mainnet. Devnet wallets always return
// `balances_count: 0` regardless of how funded they are. Bifurcate by
// detected cluster: devnet → query Solana RPC directly; mainnet → SIM.
//
// Same response shape on both paths so balance-widget.tsx and the spend graph
// (B3) don't have to branch.

import {
  Connection,
  PublicKey,
  ParsedAccountData,
} from "@solana/web3.js";

import { resolveRpcUrl, detectClusterFromUrl } from "./rpc";

export type BalanceSource = "devnet-rpc" | "sim" | "stub" | "error";

export interface Balance {
  chain?: string;
  address?: string;     // mint pubkey for SPL, "native" for SOL
  symbol?: string;
  name?: string;
  amount?: string;      // human-readable, e.g. "1.250000"
  decimals?: number;
  valueUsd?: number;
  [k: string]: unknown;
}

export interface BalancesResponse {
  balances?: Balance[];
  _source?: BalanceSource;
  _stub?: string;
  _cluster?: "devnet" | "mainnet" | "unknown";
  [k: string]: unknown;
}

interface CacheEntry {
  fetchedAt: number;
  payload: BalancesResponse;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

const KNOWN_MINTS: Record<string, { symbol: string; name: string }> = {
  // Mainnet USDC
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: "USDC", name: "USD Coin" },
  // Devnet USDC (Circle)
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU": {
    symbol: "USDC",
    name: "USD Coin (devnet)",
  },
  // Mainnet USDT
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: "USDT", name: "Tether USD" },
};

function shortMint(mint: string): string {
  return mint.length > 8 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

async function fetchDevnetRpc(address: string, rpcUrl: string): Promise<BalancesResponse> {
  const conn = new Connection(rpcUrl, "confirmed");
  const owner = new PublicKey(address);

  const [lamports, tokenAccounts, token2022Accounts] = await Promise.all([
    conn.getBalance(owner, "confirmed"),
    conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
    conn
      .getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID })
      .catch(() => ({ value: [] as Array<{ pubkey: PublicKey; account: { data: ParsedAccountData } }> })),
  ]);

  const balances: Balance[] = [];

  // Native SOL
  balances.push({
    chain: "solana:devnet",
    address: "native",
    symbol: "SOL",
    name: "Solana",
    amount: (lamports / 1_000_000_000).toFixed(9),
    decimals: 9,
  });

  // SPL tokens (Token + Token-2022)
  const allTokenAccounts = [...tokenAccounts.value, ...token2022Accounts.value];
  for (const acc of allTokenAccounts) {
    const data = acc.account.data;
    if (!("parsed" in data)) continue;
    const info = (data as ParsedAccountData).parsed?.info as
      | {
          mint?: string;
          tokenAmount?: { amount?: string; decimals?: number; uiAmountString?: string };
        }
      | undefined;
    const mint = info?.mint;
    const ta = info?.tokenAmount;
    if (!mint || !ta) continue;
    if (Number(ta.amount ?? "0") === 0) continue; // skip zero-balance ATAs
    const known = KNOWN_MINTS[mint];
    balances.push({
      chain: "solana:devnet",
      address: mint,
      symbol: known?.symbol ?? shortMint(mint),
      name: known?.name ?? mint,
      amount: ta.uiAmountString ?? ta.amount,
      decimals: ta.decimals,
    });
  }

  return {
    balances,
    _source: "devnet-rpc",
    _cluster: "devnet",
    wallet_address: address,
    balances_count: balances.length,
  };
}

async function fetchSim(address: string, apiKey: string): Promise<BalancesResponse> {
  const r = await fetch(`https://api.sim.dune.com/beta/svm/balances/${address}`, {
    headers: { "X-Sim-Api-Key": apiKey },
  });
  if (!r.ok) {
    throw new Error(`Dune SIM ${r.status}: ${await r.text()}`);
  }
  const json = (await r.json()) as BalancesResponse;
  return { ...json, _source: "sim", _cluster: "mainnet" };
}

export async function fetchBalances(address: string): Promise<BalancesResponse> {
  const now = Date.now();
  const cached = cache.get(address);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.payload;
  }

  const rpcUrl = resolveRpcUrl();
  const cluster = detectClusterFromUrl(rpcUrl);
  const apiKey = process.env.SIM_API_KEY;

  let payload: BalancesResponse;
  try {
    if (cluster === "devnet") {
      payload = await fetchDevnetRpc(address, rpcUrl);
    } else if (cluster === "mainnet" && apiKey) {
      payload = await fetchSim(address, apiKey);
    } else if (apiKey) {
      // Unknown cluster but a SIM key is configured — let the user see what SIM
      // returns rather than guessing. Devnet pubkeys will come back empty.
      payload = await fetchSim(address, apiKey);
    } else {
      payload = {
        balances: [],
        _source: "stub",
        _cluster: cluster,
        _stub: "no SIM_API_KEY and cluster is not devnet",
      };
    }
  } catch (err) {
    payload = {
      balances: [],
      _source: "error",
      _cluster: cluster,
      _stub: err instanceof Error ? err.message : String(err),
    };
  }

  cache.set(address, { fetchedAt: now, payload });
  return payload;
}

// Re-export for back-compat with existing imports.
export { fetchBalances as fetchSimBalances };
