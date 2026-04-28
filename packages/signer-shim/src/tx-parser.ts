import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  decodeTransferCheckedInstruction,
  decodeTransferInstruction,
  getMint,
} from "@solana/spl-token";
import type { Connection } from "@solana/web3.js";
import type { Token, TxSummary } from "@sentinel/policy-dsl";

import type { PriceOracle } from "./price-oracle.js";
import { SentinelError } from "./errors.js";

const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
// D9: Token-2022 has new extensions (transfer hooks, confidential transfers)
// that change instruction layout and trust assumptions. Reject explicitly so
// agents can't slip past via the newer program — caller must use Token v1.
const TOKEN_2022_PROGRAM_ID_B58 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export interface ParseEnv {
  splDecimalsCache: Map<string, number>;
  oracle: PriceOracle;
  connection?: Connection;
  agent: string;
  now?: number;
  usdcMints?: ReadonlyArray<string>;
}

export async function parseTx(tx: Transaction, env: ParseEnv): Promise<TxSummary[]> {
  if (tx instanceof VersionedTransaction) {
    throw new SentinelError(
      "UNSUPPORTED_TX",
      "Versioned (v0) transactions are rejected in MVP",
    );
  }
  if (!tx.instructions || tx.instructions.length === 0) {
    throw new SentinelError("UNSUPPORTED_TX", "Transaction has no instructions");
  }

  const usdcMints = new Set(env.usdcMints ?? [USDC_MINT_MAINNET, USDC_MINT_DEVNET]);
  const now = env.now ?? Date.now();
  const out: TxSummary[] = [];

  for (const ix of tx.instructions) {
    const programId = ix.programId.toBase58();

    if (programId === TOKEN_2022_PROGRAM_ID_B58) {
      throw new SentinelError(
        "TOKEN_2022_NOT_SUPPORTED",
        "Token-2022 transfers are rejected in MVP — extensions (hooks, confidential transfers) change trust assumptions",
      );
    }

    if (ix.programId.equals(SystemProgram.programId)) {
      out.push(await parseSystemIx(ix, env, programId, now, usdcMints));
      continue;
    }

    if (ix.programId.equals(TOKEN_PROGRAM_ID)) {
      out.push(await parseTokenIx(ix, env, programId, now, usdcMints));
      continue;
    }

    out.push({
      agent: env.agent,
      token: { mint: programId },
      amount: 0,
      destination: ix.keys[0]?.pubkey.toBase58() ?? "unknown",
      programId,
      usdValue: 0,
      timestamp: now,
    });
  }

  return out;
}

async function parseSystemIx(
  ix: Transaction["instructions"][number],
  env: ParseEnv,
  programId: string,
  now: number,
  usdcMints: Set<string>,
): Promise<TxSummary> {
  let amount = 0;
  let destination = "unknown";

  try {
    const decoded = SystemInstruction.decodeInstructionType(ix);
    if (decoded === "Transfer") {
      const transfer = SystemInstruction.decodeTransfer(ix);
      amount = Number(transfer.lamports) / 1_000_000_000;
      destination = transfer.toPubkey.toBase58();
    }
  } catch {
    // Non-transfer or undecodable system ix → leave amount=0; engine sees a no-op
  }

  return {
    agent: env.agent,
    token: "SOL",
    amount,
    destination,
    programId,
    usdValue: amount > 0 ? await env.oracle.usd("SOL", amount) : 0,
    timestamp: now,
  };
  void usdcMints;
}

async function parseTokenIx(
  ix: Transaction["instructions"][number],
  env: ParseEnv,
  programId: string,
  now: number,
  usdcMints: Set<string>,
): Promise<TxSummary> {
  const checked = tryDecodeChecked(ix);
  const fallback = checked ?? tryDecodeLegacy(ix);

  if (!fallback) {
    return {
      agent: env.agent,
      token: { mint: programId },
      amount: 0,
      destination: ix.keys[2]?.pubkey.toBase58() ?? "unknown",
      programId,
      usdValue: 0,
      timestamp: now,
    };
  }

  const { destinationPubkey, amount: rawAmount, mint, decimals: decodedDecimals } = fallback;
  const mintB58 = mint.toBase58();

  const decimals =
    decodedDecimals ??
    env.splDecimalsCache.get(mintB58) ??
    (env.connection ? await fetchAndCacheDecimals(env.connection, mint, env.splDecimalsCache) : 0);

  const amount = Number(rawAmount) / 10 ** decimals;
  const token: Token = usdcMints.has(mintB58) ? "USDC" : { mint: mintB58 };
  const usdValue = amount > 0 ? await safeUsd(env.oracle, token, amount) : 0;

  return {
    agent: env.agent,
    token,
    amount,
    destination: destinationPubkey.toBase58(),
    programId,
    usdValue,
    timestamp: now,
  };
}

interface DecodedTransfer {
  destinationPubkey: PublicKey;
  amount: bigint;
  mint: PublicKey;
  decimals: number | null;
}

function tryDecodeChecked(
  ix: Transaction["instructions"][number],
): DecodedTransfer | null {
  try {
    const d = decodeTransferCheckedInstruction(ix, TOKEN_PROGRAM_ID);
    return {
      destinationPubkey: d.keys.destination.pubkey,
      amount: d.data.amount,
      mint: d.keys.mint.pubkey,
      decimals: d.data.decimals,
    };
  } catch {
    return null;
  }
}

function tryDecodeLegacy(
  ix: Transaction["instructions"][number],
): DecodedTransfer | null {
  try {
    const d = decodeTransferInstruction(ix, TOKEN_PROGRAM_ID);
    return {
      destinationPubkey: d.keys.destination.pubkey,
      amount: d.data.amount,
      mint: d.keys.source.pubkey,
      decimals: null,
    };
  } catch {
    return null;
  }
}

async function fetchAndCacheDecimals(
  connection: Connection,
  mint: PublicKey,
  cache: Map<string, number>,
): Promise<number> {
  const info = await getMint(connection, mint);
  cache.set(mint.toBase58(), info.decimals);
  return info.decimals;
}

async function safeUsd(oracle: PriceOracle, token: Token, amount: number): Promise<number> {
  try {
    return await oracle.usd(token, amount);
  } catch (err) {
    if (err instanceof SentinelError && err.code === "ORACLE_UNAVAILABLE") {
      return Number.POSITIVE_INFINITY;
    }
    throw err;
  }
}
