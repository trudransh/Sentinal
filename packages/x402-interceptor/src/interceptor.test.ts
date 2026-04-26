import { describe, expect, it, vi } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";

import { policyRoot } from "@sentinel/policy-dsl";
import {
  SentinelSigner,
  createInMemoryRateLimiter,
  stubOracle,
  type PolicyFetcher,
} from "@sentinel/signer-shim";

import { createSentinelFetch, parseRequirements, PaymentDeniedError, PaymentEscalationRejectedError } from "./interceptor.js";
import { createStubPaymentBuilder } from "./payment-builder-stub.js";
import type { PaymentRequirements } from "./types.js";

const PROGRAM_ID = new PublicKey("2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk");
const TREASURY = "DpfxWR9oBJeDL8vf9nHVGUK4BKDcQfGUmo5Tpah9joMN";
const BLOCKED = "2NGLZrjxK1FN8HkEawQuGap8MyMbnxE686BBDvv684DD";

interface TestSetup {
  agent: Keypair;
  signer: SentinelSigner;
  rl: ReturnType<typeof createInMemoryRateLimiter>;
}

function withSigner(policyOverrides: Record<string, unknown>): TestSetup {
  const agent = Keypair.generate();
  const tmpDir = mkdtempSync(join(tmpdir(), "x402-test-"));
  const policy = {
    version: 1,
    agent: agent.publicKey.toBase58(),
    caps: [{ token: "USDC", max_per_tx: 1 }],
    allowlist: { destinations: [TREASURY] },
    denylist: { destinations: [BLOCKED] },
    escalate_above: { usd_value: 1 },
    ...policyOverrides,
  };
  const policyPath = join(tmpDir, "policy.yml");
  writeFileSync(policyPath, yamlStringify(policy), "utf8");
  void policyRoot(policy as never);
  const fetcher: PolicyFetcher = {
    async ensureMatch() {},
    invalidateCache() {},
    async close() {},
  };
  const rl = createInMemoryRateLimiter(agent.publicKey.toBase58());
  const signer = new SentinelSigner({
    policyPath,
    agentKeypair: agent,
    registryProgramId: PROGRAM_ID,
    oracle: stubOracle,
    rateLimiter: rl,
    policyFetcher: fetcher,
  });
  return { agent, signer, rl };
}

const requirementsHeader = (req: PaymentRequirements): string => JSON.stringify(req);

function fakeFetch(handler: (req: { url: string; init?: RequestInit }) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return handler({ url, init });
  }) as unknown as typeof fetch;
}

describe("createSentinelFetch", () => {
  it("passes a 200 response straight through", async () => {
    const { agent, signer, rl } = withSigner({});
    try {
      const fetch200 = fakeFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
      const f = createSentinelFetch({
        signer,
        paymentBuilder: createStubPaymentBuilder({ agent }),
        baseFetch: fetch200,
      });
      const res = await f("https://example/endpoint");
      expect(res.status).toBe(200);
    } finally {
      await signer.close();
      rl.close();
    }
  });

  it("auto-approves a 402 when policy allows", async () => {
    const { agent, signer, rl } = withSigner({});
    try {
      const reqs: PaymentRequirements = {
        scheme: "exact",
        network: "solana:devnet",
        amount: 0.001,
        token: "USDC",
        payTo: TREASURY,
        resourceUrl: "https://example/cheap",
      };

      let calls = 0;
      const fetcher = fakeFetch(({ init }) => {
        calls++;
        if (calls === 1) {
          return new Response(JSON.stringify({ error: "payment required" }), {
            status: 402,
            headers: { "x-payment-requirements": requirementsHeader(reqs) },
          });
        }
        const paymentHeader = new Headers(init?.headers).get("x-payment");
        expect(paymentHeader).toBeTruthy();
        return new Response(JSON.stringify({ data: "ok" }), { status: 200 });
      });

      const f = createSentinelFetch({
        signer,
        paymentBuilder: createStubPaymentBuilder({ agent }),
        baseFetch: fetcher,
      });
      const res = await f("https://example/cheap");
      expect(res.status).toBe(200);
      expect(calls).toBe(2);
    } finally {
      await signer.close();
      rl.close();
    }
  });

  it("throws PaymentDeniedError when destination is on denylist", async () => {
    const { agent, signer, rl } = withSigner({});
    try {
      const reqs: PaymentRequirements = {
        scheme: "exact",
        network: "solana:devnet",
        amount: 0.001,
        token: "USDC",
        payTo: BLOCKED,
        resourceUrl: "https://example/blocked",
      };
      const fetcher = fakeFetch(
        () =>
          new Response("", {
            status: 402,
            headers: { "x-payment-requirements": requirementsHeader(reqs) },
          }),
      );
      const f = createSentinelFetch({
        signer,
        paymentBuilder: createStubPaymentBuilder({ agent }),
        baseFetch: fetcher,
      });
      await expect(f("https://example/blocked")).rejects.toBeInstanceOf(
        PaymentDeniedError,
      );
    } finally {
      await signer.close();
      rl.close();
    }
  });

  it("escalates when usd value exceeds threshold; rejection raises EscalationRejected", async () => {
    const { agent, signer, rl } = withSigner({
      caps: [{ token: "USDC", max_per_tx: 1000 }],
    });
    try {
      const reqs: PaymentRequirements = {
        scheme: "exact",
        network: "solana:devnet",
        amount: 5,
        token: "USDC",
        payTo: TREASURY,
        resourceUrl: "https://example/expensive",
      };
      const fetcher = fakeFetch(
        () =>
          new Response("", {
            status: 402,
            headers: { "x-payment-requirements": requirementsHeader(reqs) },
          }),
      );
      const onEscalate = vi.fn(async () => "reject" as const);
      const f = createSentinelFetch({
        signer,
        paymentBuilder: createStubPaymentBuilder({ agent }),
        baseFetch: fetcher,
        onEscalate,
      });
      await expect(f("https://example/expensive")).rejects.toBeInstanceOf(
        PaymentEscalationRejectedError,
      );
      expect(onEscalate).toHaveBeenCalledOnce();
    } finally {
      await signer.close();
      rl.close();
    }
  });

  it("parseRequirements rejects malformed headers", () => {
    expect(() => parseRequirements(JSON.stringify({ scheme: "exact" }))).toThrow();
  });
});
