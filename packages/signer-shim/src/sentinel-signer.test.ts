import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  createTransferCheckedInstruction,
} from "@solana/spl-token";
import { policyRoot } from "@sentinel/policy-dsl";
import { stringify as yamlStringify } from "yaml";

import { SentinelSigner } from "./sentinel-signer.js";
import { SentinelError } from "./errors.js";
import { stubOracle } from "./price-oracle.js";
import {
  createInMemoryRateLimiter,
  type RateLimiter,
} from "./rate-limiter.js";
import type { OnChainPolicyRecord, PolicyFetcher } from "./policy-fetch.js";

const PROGRAM_ID = new PublicKey("2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk");
const USDC_DEV = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

interface Setup {
  policyPath: string;
  agentKeypair: Keypair;
  rateLimiter: RateLimiter;
  fetcher: PolicyFetcher;
  cleanup: () => void;
}

function setup(policyOverrides: Record<string, unknown> = {}): Setup {
  const dir = mkdtempSync(join(tmpdir(), "sentinel-test-"));
  const agentKeypair = Keypair.generate();
  const policy = {
    version: 1,
    agent: agentKeypair.publicKey.toBase58(),
    caps: [{ token: "SOL", max_per_day: 1 }],
    ...policyOverrides,
  };
  const policyPath = join(dir, "policy.yml");
  writeFileSync(policyPath, yamlStringify(policy), "utf8");
  const root = policyRoot(policy as never);
  const onChain: OnChainPolicyRecord = {
    owner: Keypair.generate().publicKey,
    agent: agentKeypair.publicKey,
    root: Array.from(root),
    version: 1,
    revoked: false,
  };
  const rateLimiter = createInMemoryRateLimiter(agentKeypair.publicKey.toBase58());
  const fetcher: PolicyFetcher = {
    async ensureMatch() {
      if (onChain.revoked) {
        throw new SentinelError("POLICY_REVOKED", "revoked");
      }
    },
    invalidateCache() {},
    async close() {},
  };
  return {
    policyPath,
    agentKeypair,
    rateLimiter,
    fetcher,
    cleanup: () => {
      rateLimiter.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function transferTx(from: PublicKey, to: PublicKey, lamports: number): Transaction {
  const tx = new Transaction();
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.feePayer = from;
  tx.add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  return tx;
}

describe("SentinelSigner", () => {
  let s: Setup;

  beforeEach(() => {
    s = setup();
  });

  it("signs an in-policy SOL transfer", async () => {
    const signer = new SentinelSigner({
      policyPath: s.policyPath,
      agentKeypair: s.agentKeypair,
      registryProgramId: PROGRAM_ID,
      oracle: stubOracle,
      rateLimiter: s.rateLimiter,
      policyFetcher: s.fetcher,
    });
    const tx = transferTx(
      s.agentKeypair.publicKey,
      Keypair.generate().publicKey,
      100_000_000,
    );
    const signed = await signer.signTransaction(tx);
    expect(signed.signatures.some((sig) => sig.signature !== null)).toBe(true);
    s.cleanup();
  });

  it("denies a transfer that exceeds max_per_day", async () => {
    const policyDir = mkdtempSync(join(tmpdir(), "sentinel-test-"));
    const agentKeypair = Keypair.generate();
    const policy = {
      version: 1,
      agent: agentKeypair.publicKey.toBase58(),
      caps: [{ token: "SOL", max_per_day: 0.05 }],
    };
    const policyPath = join(policyDir, "policy.yml");
    writeFileSync(policyPath, yamlStringify(policy), "utf8");
    const root = policyRoot(policy as never);
    const fetcher: PolicyFetcher = {
      async ensureMatch() {},
      invalidateCache() {},
      async close() {},
    };
    void root;
    const rl = createInMemoryRateLimiter(agentKeypair.publicKey.toBase58());
    try {
      const signer = new SentinelSigner({
        policyPath,
        agentKeypair,
        registryProgramId: PROGRAM_ID,
        oracle: stubOracle,
        rateLimiter: rl,
        policyFetcher: fetcher,
      });
      const tx = transferTx(
        agentKeypair.publicKey,
        Keypair.generate().publicKey,
        100_000_000,
      );
      await expect(signer.signTransaction(tx)).rejects.toMatchObject({
        code: "POLICY_VIOLATION",
      });
    } finally {
      rl.close();
      rmSync(policyDir, { recursive: true, force: true });
    }
  });

  it("escalates when usdValue exceeds escalate_above and throws ESCALATION_REQUIRED", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-test-"));
    const agentKeypair = Keypair.generate();
    const policy = {
      version: 1,
      agent: agentKeypair.publicKey.toBase58(),
      caps: [{ token: "SOL", max_per_day: 1 }],
      escalate_above: { usd_value: 0.05 },
    };
    const policyPath = join(dir, "policy.yml");
    writeFileSync(policyPath, yamlStringify(policy), "utf8");
    const fetcher: PolicyFetcher = {
      async ensureMatch() {},
      invalidateCache() {},
      async close() {},
    };
    const rl = createInMemoryRateLimiter(agentKeypair.publicKey.toBase58());
    try {
      const signer = new SentinelSigner({
        policyPath,
        agentKeypair,
        registryProgramId: PROGRAM_ID,
        oracle: stubOracle,
        rateLimiter: rl,
        policyFetcher: fetcher,
      });
      const tx = transferTx(
        agentKeypair.publicKey,
        Keypair.generate().publicKey,
        100_000_000,
      );
      await expect(signer.signTransaction(tx)).rejects.toMatchObject({
        code: "ESCALATION_REQUIRED",
      });
    } finally {
      rl.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("propagates POLICY_MISMATCH from the fetcher and refuses to sign", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-test-"));
    const agentKeypair = Keypair.generate();
    const policy = {
      version: 1,
      agent: agentKeypair.publicKey.toBase58(),
    };
    const policyPath = join(dir, "policy.yml");
    writeFileSync(policyPath, yamlStringify(policy), "utf8");
    const fetcher: PolicyFetcher = {
      async ensureMatch() {
        throw new SentinelError("POLICY_MISMATCH", "drift");
      },
      invalidateCache() {},
      async close() {},
    };
    const rl = createInMemoryRateLimiter(agentKeypair.publicKey.toBase58());
    try {
      const signer = new SentinelSigner({
        policyPath,
        agentKeypair,
        registryProgramId: PROGRAM_ID,
        oracle: stubOracle,
        rateLimiter: rl,
        policyFetcher: fetcher,
      });
      const tx = transferTx(
        agentKeypair.publicKey,
        Keypair.generate().publicKey,
        1,
      );
      await expect(signer.signTransaction(tx)).rejects.toMatchObject({
        code: "POLICY_MISMATCH",
      });
    } finally {
      rl.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a policy whose 'agent' field does not match the signer", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-test-"));
    const agentKeypair = Keypair.generate();
    const wrongAgent = Keypair.generate().publicKey.toBase58();
    const policyPath = join(dir, "policy.yml");
    writeFileSync(
      policyPath,
      yamlStringify({ version: 1, agent: wrongAgent }),
      "utf8",
    );
    expect(
      () =>
        new SentinelSigner({
          policyPath,
          agentKeypair,
          registryProgramId: PROGRAM_ID,
          oracle: stubOracle,
          policyFetcher: {
            async ensureMatch() {},
            invalidateCache() {},
            async close() {},
          },
        }),
    ).toThrow(SentinelError);
    rmSync(dir, { recursive: true, force: true });
  });

  it("multi-instruction tx: one denial fails the whole tx", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-test-"));
    const agentKeypair = Keypair.generate();
    const goodDest = Keypair.generate().publicKey;
    const badDest = Keypair.generate().publicKey;
    const policy = {
      version: 1,
      agent: agentKeypair.publicKey.toBase58(),
      denylist: { destinations: [badDest.toBase58()] },
    };
    const policyPath = join(dir, "policy.yml");
    writeFileSync(policyPath, yamlStringify(policy), "utf8");
    const fetcher: PolicyFetcher = {
      async ensureMatch() {},
      invalidateCache() {},
      async close() {},
    };
    const rl = createInMemoryRateLimiter(agentKeypair.publicKey.toBase58());
    try {
      const signer = new SentinelSigner({
        policyPath,
        agentKeypair,
        registryProgramId: PROGRAM_ID,
        oracle: stubOracle,
        rateLimiter: rl,
        policyFetcher: fetcher,
      });
      const tx = new Transaction();
      tx.recentBlockhash = "11111111111111111111111111111111";
      tx.feePayer = agentKeypair.publicKey;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: agentKeypair.publicKey,
          toPubkey: goodDest,
          lamports: 1_000,
        }),
      );
      tx.add(
        SystemProgram.transfer({
          fromPubkey: agentKeypair.publicKey,
          toPubkey: badDest,
          lamports: 1_000,
        }),
      );
      await expect(signer.signTransaction(tx)).rejects.toMatchObject({
        code: "POLICY_VIOLATION",
      });
    } finally {
      rl.close();
      rmSync(dir, { recursive: true, force: true });
    }
    void USDC_DEV;
    void createTransferCheckedInstruction;
  });
});
