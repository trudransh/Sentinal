import { Transaction } from "@solana/web3.js";
import type { TxSummary } from "@sentinel/policy-dsl";

/**
 * Tentative Zerion ctx shape — replace with the probed schema in
 * docs/policy-context-shape.md after running P0.T4.
 */
export interface ZerionCtx {
  transaction?: {
    chain?: string;
    from?: string;
    to?: string;
    data?: string;
    value?: string;
    [k: string]: unknown;
  };
  policy_config?: Record<string, unknown>;
  [k: string]: unknown;
}

const SOLANA_CHAIN_TOKENS = ["solana", "sol"] as const;

const stripHex = (s: string): string => (s.startsWith("0x") ? s.slice(2) : s);

export interface AdapterOptions {
  agent: string;
  now?: () => number;
  isSolanaChain?: (chain: string | undefined) => boolean;
}

export function defaultIsSolanaChain(chain: string | undefined): boolean {
  if (!chain) return false;
  const lower = chain.toLowerCase();
  return SOLANA_CHAIN_TOKENS.some((t) => lower.includes(t));
}

export function adaptCtx(ctx: ZerionCtx, opts: AdapterOptions): TxSummary[] | null {
  const isSolana = (opts.isSolanaChain ?? defaultIsSolanaChain)(
    ctx.transaction?.chain,
  );
  if (!isSolana) return null;

  const data = ctx.transaction?.data;
  if (!data) return null;

  const tx = decodeSolanaTx(data);
  if (!tx) return null;

  const now = (opts.now ?? Date.now)();
  const summaries: TxSummary[] = [];
  for (const ix of tx.instructions) {
    summaries.push({
      agent: opts.agent,
      token: { mint: ix.programId.toBase58() },
      amount: 0,
      destination: ix.keys[0]?.pubkey.toBase58() ?? "unknown",
      programId: ix.programId.toBase58(),
      usdValue: 0,
      timestamp: now,
    });
  }
  return summaries;
}

function decodeSolanaTx(data: string): Transaction | null {
  const candidates: Buffer[] = [];
  try {
    candidates.push(Buffer.from(stripHex(data), "hex"));
  } catch {
    /* skip */
  }
  try {
    candidates.push(Buffer.from(data, "base64"));
  } catch {
    /* skip */
  }
  for (const buf of candidates) {
    if (buf.byteLength === 0) continue;
    try {
      return Transaction.from(buf);
    } catch {
      /* try next */
    }
  }
  return null;
}
