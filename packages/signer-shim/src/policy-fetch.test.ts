import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { parsePolicy, policyRoot, type Policy } from "@sentinel/policy-dsl";
import { createPolicyFetcher, type OnChainPolicyRecord } from "./policy-fetch.js";
import { SentinelError } from "./errors.js";

const PROGRAM_ID = new PublicKey("2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk");

function fakeConnection() {
  const conn = {
    onLogs: vi.fn(() => 1),
    removeOnLogsListener: vi.fn(async () => {}),
  };
  return conn;
}

function policy(agentB58: string): Policy {
  return parsePolicy({
    version: 1,
    agent: agentB58,
    caps: [{ token: "SOL", max_per_day: 1 }],
  });
}

describe("policy-fetch", () => {
  it("ensureMatch passes when local root equals on-chain root", async () => {
    const agent = Keypair.generate().publicKey;
    const p = policy(agent.toBase58());
    const onChain: OnChainPolicyRecord = {
      owner: Keypair.generate().publicKey,
      agent,
      root: Array.from(policyRoot(p)),
      version: 1,
      revoked: false,
    };
    const fetcher = createPolicyFetcher({
      connection: fakeConnection() as never,
      programId: PROGRAM_ID,
      agent,
      fetchAccount: async () => onChain,
    });
    await expect(fetcher.ensureMatch(p)).resolves.toBeUndefined();
    await fetcher.close();
  });

  it("throws POLICY_MISMATCH when roots differ", async () => {
    const agent = Keypair.generate().publicKey;
    const p = policy(agent.toBase58());
    const onChain: OnChainPolicyRecord = {
      owner: Keypair.generate().publicKey,
      agent,
      root: Array.from(new Uint8Array(32).fill(0xaa)),
      version: 1,
      revoked: false,
    };
    const fetcher = createPolicyFetcher({
      connection: fakeConnection() as never,
      programId: PROGRAM_ID,
      agent,
      fetchAccount: async () => onChain,
    });
    await expect(fetcher.ensureMatch(p)).rejects.toMatchObject({
      code: "POLICY_MISMATCH",
    });
    await fetcher.close();
  });

  it("throws POLICY_REVOKED when on-chain record is revoked", async () => {
    const agent = Keypair.generate().publicKey;
    const p = policy(agent.toBase58());
    const onChain: OnChainPolicyRecord = {
      owner: Keypair.generate().publicKey,
      agent,
      root: Array.from(policyRoot(p)),
      version: 5,
      revoked: true,
    };
    const fetcher = createPolicyFetcher({
      connection: fakeConnection() as never,
      programId: PROGRAM_ID,
      agent,
      fetchAccount: async () => onChain,
    });
    await expect(fetcher.ensureMatch(p)).rejects.toMatchObject({
      code: "POLICY_REVOKED",
    });
    await fetcher.close();
  });

  it("throws POLICY_NOT_FOUND when account does not exist", async () => {
    const agent = Keypair.generate().publicKey;
    const fetcher = createPolicyFetcher({
      connection: fakeConnection() as never,
      programId: PROGRAM_ID,
      agent,
      fetchAccount: async () => null,
    });
    await expect(fetcher.ensureMatch(policy(agent.toBase58()))).rejects.toMatchObject({
      code: "POLICY_NOT_FOUND",
    });
    await fetcher.close();
  });

  it("caches on-chain reads within TTL", async () => {
    const agent = Keypair.generate().publicKey;
    const p = policy(agent.toBase58());
    const onChain: OnChainPolicyRecord = {
      owner: Keypair.generate().publicKey,
      agent,
      root: Array.from(policyRoot(p)),
      version: 1,
      revoked: false,
    };
    const fetchSpy = vi.fn(async () => onChain);
    const fetcher = createPolicyFetcher({
      connection: fakeConnection() as never,
      programId: PROGRAM_ID,
      agent,
      fetchAccount: fetchSpy,
      cacheTtlMs: 60_000,
      now: () => 1_000_000,
    });
    await fetcher.ensureMatch(p);
    await fetcher.ensureMatch(p);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await fetcher.close();
  });

  it("re-fetches after explicit invalidation", async () => {
    const agent = Keypair.generate().publicKey;
    const p = policy(agent.toBase58());
    const onChain: OnChainPolicyRecord = {
      owner: Keypair.generate().publicKey,
      agent,
      root: Array.from(policyRoot(p)),
      version: 1,
      revoked: false,
    };
    const fetchSpy = vi.fn(async () => onChain);
    const fetcher = createPolicyFetcher({
      connection: fakeConnection() as never,
      programId: PROGRAM_ID,
      agent,
      fetchAccount: fetchSpy,
      cacheTtlMs: 60_000,
      now: () => 1_000_000,
    });
    await fetcher.ensureMatch(p);
    fetcher.invalidateCache();
    await fetcher.ensureMatch(p);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await fetcher.close();
  });

  it("wraps RPC errors as REGISTRY_FETCH_FAILED", async () => {
    const agent = Keypair.generate().publicKey;
    const fetcher = createPolicyFetcher({
      connection: fakeConnection() as never,
      programId: PROGRAM_ID,
      agent,
      fetchAccount: async () => {
        throw new Error("RPC connection refused");
      },
    });
    await expect(fetcher.ensureMatch(policy(agent.toBase58()))).rejects.toMatchObject({
      code: "REGISTRY_FETCH_FAILED",
    });
    await fetcher.close();
  });

  it("expected: caught SentinelError types", () => {
    expect(() => {
      throw new SentinelError("POLICY_MISMATCH", "x");
    }).toThrow(SentinelError);
  });
});
