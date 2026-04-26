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
  let logsSubId: number | null = null;

  try {
    logsSubId = opts.connection.onLogs(opts.programId, (logs) => {
      if (logs.logs.some((l) => l.includes(pda.toBase58()))) {
        cache = null;
      }
    });
  } catch {
    logsSubId = null;
  }

  return {
    async ensureMatch(localPolicy: Policy): Promise<void> {
      if (!cache || now() - cache.fetchedAt >= ttl) {
        const record = await fetchSafely(opts, pda);
        if (!record) {
          throw new SentinelError(
            "POLICY_NOT_FOUND",
            `On-chain PolicyRecord not found for agent ${opts.agent.toBase58()}`,
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
        throw new SentinelError(
          "POLICY_MISMATCH",
          `Local policy root differs from on-chain root`,
          { local: localHex, onChain: cache.rootHex },
        );
      }
    },
    invalidateCache() {
      cache = null;
    },
    async close() {
      if (logsSubId !== null) {
        try {
          await opts.connection.removeOnLogsListener(logsSubId);
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
