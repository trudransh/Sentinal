// C3: decode Helius enhanced webhooks. Helius leaves `events: {}` empty for
// programs without a published Anchor IDL, so we decode the instruction data
// directly via discriminator + arg layout. See docs/helius-payload.md for the
// captured shape and discriminator table.

import { PublicKey } from "@solana/web3.js";

export interface HeliusEnhancedInstruction {
  programId: string;
  data?: string;
  accounts?: string[];
  innerInstructions?: HeliusEnhancedInstruction[];
}

export interface HeliusEnhancedTx {
  signature: string;
  type?: string;
  source?: string;
  description?: string;
  feePayer?: string;
  events?: Record<string, unknown>;
  accountData?: Array<{ account: string; nativeBalanceChange?: number }>;
  instructions?: HeliusEnhancedInstruction[];
}

export type EventKind = "registered" | "updated" | "revoked" | "unknown";

export interface DecodedEvent {
  kind: EventKind;
  /** Agent pubkey (base58) — only available for register_policy from instruction args. */
  agent: string;
  /** Policy PDA from accounts[1] of register/update/revoke ix. Useful for update/revoke where agent is implicit. */
  policyPda: string | null;
  /** Owner of the policy — feePayer for register, accounts[0] for update/revoke. */
  owner: string | null;
  /** 32-byte sha256 root in lowercase hex. Available for register_policy and update_policy. */
  rootHex: string | null;
}

// Discriminators from target/idl/sentinel_registry.json. Keep in sync if the
// IDL is regenerated; ts-mocha tests assert the bytes match.
const DISC_REGISTER = new Uint8Array([62, 66, 167, 36, 252, 227, 38, 132]);
const DISC_UPDATE = new Uint8Array([212, 245, 246, 7, 163, 151, 18, 57]);
const DISC_REVOKE = new Uint8Array([49, 221, 179, 43, 154, 148, 35, 4]);

const PROGRAM_ID =
  process.env.SENTINEL_PROGRAM_ID ?? process.env.NEXT_PUBLIC_SENTINEL_PROGRAM_ID;

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < BASE58_ALPHABET.length; i++) m[BASE58_ALPHABET[i]!] = i;
  return m;
})();

// Base58 decoder. ~30 lines, no dep. Returns null on invalid input rather
// than throwing — webhook payloads can be adversarial and we don't want a
// malformed `data` field to take down the route.
function base58Decode(s: string): Uint8Array | null {
  if (!s) return null;
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const size = (((s.length - zeros) * 733) / 1000 + 1) | 0;
  const b256 = new Uint8Array(size);
  for (let i = zeros; i < s.length; i++) {
    const c = BASE58_MAP[s[i]!];
    if (c === undefined) return null;
    let carry = c;
    for (let j = size - 1; j >= 0; j--) {
      carry += 58 * b256[j]!;
      b256[j] = carry & 0xff;
      carry >>= 8;
    }
    if (carry !== 0) return null;
  }
  let leading = 0;
  while (leading < size && b256[leading] === 0) leading++;
  const out = new Uint8Array(zeros + (size - leading));
  out.set(b256.subarray(leading), zeros);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array, len: number): boolean {
  if (a.length < len || b.length < len) return false;
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function pubkeyFromBytes(bytes: Uint8Array, offset: number): string | null {
  if (bytes.length < offset + 32) return null;
  try {
    return new PublicKey(bytes.subarray(offset, offset + 32)).toBase58();
  } catch {
    return null;
  }
}

function findSentinelInstruction(
  tx: HeliusEnhancedTx,
): HeliusEnhancedInstruction | null {
  if (!tx.instructions || tx.instructions.length === 0) return null;
  const targetProgram = PROGRAM_ID;

  // Prefer the first ix whose programId matches our deployed program. Fall
  // back to checking inner CPIs in case the entry point was a wrapper.
  if (targetProgram) {
    for (const ix of tx.instructions) {
      if (ix.programId === targetProgram) return ix;
      for (const inner of ix.innerInstructions ?? []) {
        if (inner.programId === targetProgram) return inner;
      }
    }
    return null;
  }

  // Without a configured program ID, fall back to "first ix" heuristic.
  return tx.instructions[0] ?? null;
}

export function classifyTx(tx: HeliusEnhancedTx): DecodedEvent {
  const empty: DecodedEvent = {
    kind: "unknown",
    agent: "unknown",
    policyPda: null,
    owner: null,
    rootHex: null,
  };

  const ix = findSentinelInstruction(tx);
  if (!ix || !ix.data) return empty;

  const bytes = base58Decode(ix.data);
  if (!bytes || bytes.length < 8) return empty;

  // accounts[0] is owner (signer) for all 3 ixs; accounts[1] is the policy PDA.
  const policyPda = ix.accounts?.[1] ?? null;
  const owner = ix.accounts?.[0] ?? tx.feePayer ?? null;

  if (bytesEqual(bytes, DISC_REGISTER, 8)) {
    // register_policy(agent: pubkey, root: [u8; 32])
    const agent = pubkeyFromBytes(bytes, 8) ?? "unknown";
    const rootHex = bytes.length >= 72 ? toHex(bytes.subarray(40, 72)) : null;
    return { kind: "registered", agent, policyPda, owner, rootHex };
  }

  if (bytesEqual(bytes, DISC_UPDATE, 8)) {
    // update_policy(new_root: [u8; 32]) — agent recoverable only via the PDA seeds,
    // which require knowing the agent key beforehand. Surface PDA + root.
    const rootHex = bytes.length >= 40 ? toHex(bytes.subarray(8, 40)) : null;
    return { kind: "updated", agent: policyPda ?? "unknown", policyPda, owner, rootHex };
  }

  if (bytesEqual(bytes, DISC_REVOKE, 8)) {
    return { kind: "revoked", agent: policyPda ?? "unknown", policyPda, owner, rootHex: null };
  }

  return empty;
}
