import { Transaction } from "@solana/web3.js";
import type { TxSummary } from "@sentinel/policy-dsl";

/**
 * ZerionCtx — verified against real `zerion` CLI runtime captures
 * (see `docs/policy-context-shape.md` and `/tmp/sentinel-zerion-ctx*.json`).
 *
 * Two captured shapes from the same dispatcher:
 *
 *   sign-message (rich runtime metadata):
 *     {
 *       api_key_id: string,
 *       chain_id: "eip155:1" | "solana:<genesis>",   // CAIP-2, TOP-LEVEL
 *       policy_config: { scripts: string[] },
 *       spending: { daily_total: string, date: string },
 *       timestamp: string,                            // ISO-8601 with ns
 *       transaction: { raw_hex: string },             // hex of signed message
 *       wallet_id: string
 *     }
 *
 *   swap pre-assembly (minimal — Zerion calls policy BEFORE building calldata):
 *     {
 *       transaction: { to: null, value: "0", data: "0x" },
 *       policy_config: { scripts: string[] }
 *     }
 *
 * Implication: for swap/bridge flows, we never see actual calldata. The
 * adapter returns an empty summary list, which the bridge's `check(ctx)`
 * (sentinel.mjs) interprets as "no decodable instructions → deny".
 */
export interface ZerionCtx {
  /** CAIP-2 chain id at the TOP level — NOT under `transaction`. */
  chain_id?: string;
  api_key_id?: string;
  wallet_id?: string;
  timestamp?: string;
  spending?: {
    daily_total?: string;
    date?: string;
    [k: string]: unknown;
  };
  policy_config?: {
    scripts?: string[];
    [k: string]: unknown;
  };
  transaction?: {
    /** Hex of the signed message body (sign-message flows). */
    raw_hex?: string;
    /** EVM/Solana calldata, hex with optional 0x prefix. "0x" or empty for stub. */
    data?: string;
    /** Recipient — null on the pre-assembly swap stub. */
    to?: string | null;
    /** Wei/lamports as a stringified BigInt. "0" on stub. */
    value?: string;
    /** Optional sender (rarely populated in the captured stubs). */
    from?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface AdapterOptions {
  agent: string;
  now?: () => number;
  isSolanaChain?: (chainId: string | undefined) => boolean;
}

const stripHex = (s: string): string => (s.startsWith("0x") ? s.slice(2) : s);

/**
 * Detect a Solana chain id in CAIP-2 form. The captured shape uses
 * `solana:<genesis-hash>` (e.g. `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`).
 * Fall back to a substring check for tooling that doesn't emit CAIP-2.
 */
export function defaultIsSolanaChain(chainId: string | undefined): boolean {
  if (!chainId) return false;
  const lower = chainId.toLowerCase();
  if (lower.startsWith("solana:")) return true;
  // Looser fallback for non-CAIP-2 emitters (e.g. some agent SDKs).
  return lower.includes("solana") || lower === "sol";
}

/**
 * Adapt a Zerion ctx into Sentinel TxSummaries.
 *
 *  - Non-Solana chain → return `null` (defer to Zerion's own EVM rules).
 *  - Solana but no `transaction.data` → return `[]` (engine: empty → deny).
 *  - Solana with stub data (`"0x"` / `""`) → return `[]`.
 *  - Solana with `raw_hex` (sign-message flow) → return `[]`. We don't
 *    pretend a signed message is a tx; the bridge denies on empty.
 *  - Solana with parseable serialized tx → one TxSummary per instruction.
 */
export function adaptCtx(ctx: ZerionCtx, opts: AdapterOptions): TxSummary[] | null {
  const isSolana = (opts.isSolanaChain ?? defaultIsSolanaChain)(ctx.chain_id);
  if (!isSolana) return null;

  // Stub pre-assembly ctx (real Zerion swap: data="0x", to=null). Treat as
  // "no decodable instructions" — the bridge denies on empty summary list,
  // which is the conservative outcome for opaque tx assembly we can't see.
  const txField = ctx.transaction;
  if (!txField) return [];

  // sign-message flow puts hex of the message in `raw_hex` — not a tx.
  if (typeof txField.raw_hex === "string" && !txField.data) {
    return [];
  }

  const data = typeof txField.data === "string" ? txField.data : null;
  if (!data || data === "0x" || data === "") return [];

  const tx = decodeSolanaTx(data);
  if (!tx) return [];

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
