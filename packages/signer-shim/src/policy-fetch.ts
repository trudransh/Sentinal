import { Connection, PublicKey } from "@solana/web3.js";
import { policyRootHex, type Policy } from "@sentinel/policy-dsl";

import { SentinelError } from "./errors.js";

export interface OnChainPolicyRecord {
  owner: PublicKey;
  agent: PublicKey;
  root: number[] | Uint8Array;
  version: number;
  revoked: boolean;
}

export interface PolicyFetcher {
  ensureMatch(localPolicy: Policy): Promise<void>;
  invalidateCache(): void;
  close(): Promise<void>;
}

export interface PolicyFetchOptions {
  connection: Connection;
  programId: PublicKey;
  agent: PublicKey;
  fetchAccount: (pda: PublicKey) => Promise<OnChainPolicyRecord | null>;
  cacheTtlMs?: number;
  now?: () => number;
}

interface CacheEntry {
  rootHex: string;
  revoked: boolean;
  fetchedAt: number;
}

export function createPolicyFetcher(opts: PolicyFetchOptions): PolicyFetcher {
  const ttl = opts.cacheTtlMs ?? 30_000;
  const now = opts.now ?? (() => Date.now());

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), opts.agent.toBuffer()],
    opts.programId,
  );

  let cache: CacheEntry | null = null;
  let accountSubId: number | null = null;
  // HARDEN: if WS subscription fails, force ttl=0 so every signing call hits
  // RPC. Better to be slow than to honour a stale cache after `update_policy`.
  let effectiveTtl = ttl;

  // HARDEN: subscribe to PDA account changes, not program logs. Logs are
  // emitted on every tx that touches the program (and a substring match on
  // log lines is forgeable with a memo or a CPI that just reads the PDA).
  // `onAccountChange` only fires when the account's data actually changes.
  try {
    accountSubId = opts.connection.onAccountChange(
      pda,
      () => {
        cache = null;
      },
      "confirmed",
    );
  } catch {
    accountSubId = null;
    effectiveTtl = 0;
  }

  return {
    async ensureMatch(localPolicy: Policy): Promise<void> {
      if (!cache || now() - cache.fetchedAt >= effectiveTtl) {
        const record = await fetchSafely(opts, pda);
        if (!record) {
          throw new SentinelError(
            "POLICY_NOT_FOUND",
            `On-chain PolicyRecord not found for agent ${opts.agent.toBase58()}`,
          );
        }
        // HARDEN: cross-check the on-chain `agent` field — a hash collision
        // is computationally infeasible but a misdirected PDA (e.g. wrong
        // programId env) would silently sign with the wrong policy.
        if (!record.agent.equals(opts.agent)) {
          throw new SentinelError(
            "REGISTRY_FETCH_FAILED",
            `On-chain PolicyRecord agent ${record.agent.toBase58()} does not match expected ${opts.agent.toBase58()}`,
          );
        }
        cache = {
          rootHex: Buffer.from(record.root).toString("hex"),
          revoked: record.revoked,
          fetchedAt: now(),
        };
      }
      if (cache.revoked) {
        throw new SentinelError("POLICY_REVOKED", "Policy is revoked on-chain");
      }
      const localHex = policyRootHex(localPolicy);
      if (localHex !== cache.rootHex) {
        // HARDEN: don't echo the on-chain root back in error details —
        // a malicious agent in the same trust domain otherwise gets a free
        // confirmation oracle for "is this YAML candidate the deployed one?"
        // localHex stays in the error message because the agent already
        // knows its own file's hash; that's not new information.
        throw new SentinelError(
          "POLICY_MISMATCH",
          `Local policy root ${localHex} does not match on-chain root`,
          { localHex },
        );
      }
    },
    invalidateCache() {
      cache = null;
    },
    async close() {
      if (accountSubId !== null) {
        try {
          await opts.connection.removeAccountChangeListener(accountSubId);
        } catch {
          /* ignore — best-effort cleanup */
        }
      }
    },
  };
}

async function fetchSafely(
  opts: PolicyFetchOptions,
  pda: PublicKey,
): Promise<OnChainPolicyRecord | null> {
  try {
    return await opts.fetchAccount(pda);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Account does not exist/i.test(msg) || /could not find/i.test(msg)) {
      return null;
    }
    throw new SentinelError(
      "REGISTRY_FETCH_FAILED",
      `Failed to fetch on-chain PolicyRecord`,
      undefined,
      { cause: err },
    );
  }
}
