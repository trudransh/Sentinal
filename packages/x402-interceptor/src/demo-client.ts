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
  type OnChainPolicyRecord,
  type PolicyFetcher,
} from "@sentinel/signer-shim";

import { createSentinelFetch } from "./interceptor.js";
import { createStubPaymentBuilder } from "./payment-builder-stub.js";

const PROGRAM_ID = new PublicKey("2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk");
const SERVER = process.env.DEMO_SERVER ?? "http://localhost:4002";
const BLOCKED_RECEIVER =
  process.env.X402_BLOCKED_ADDRESS ?? "2NGLZrjxK1FN8HkEawQuGap8MyMbnxE686BBDvv684DD";

async function main(): Promise<void> {
  const agent = Keypair.generate();
  const treasury = process.env.X402_RECEIVING_ADDRESS ?? "DpfxWR9oBJeDL8vf9nHVGUK4BKDcQfGUmo5Tpah9joMN";

  const basePolicy = {
    version: 1,
    agent: agent.publicKey.toBase58(),
    // Keep /expensive (5 USDC) under per-tx cap so it routes to escalation
    // (escalate_above.usd_value) rather than hard deny from caps.
    caps: [{ token: "USDC", max_per_tx: 10, max_per_day: 50 }],
    allowlist: { destinations: [treasury] },
    denylist: { destinations: [BLOCKED_RECEIVER] },
    escalate_above: { usd_value: 1 },
    rate_limit: { max_tx_per_minute: 6 },
  };

  const tmpDir = mkdtempSync(join(tmpdir(), "sentinel-demo-"));
  const policyPath = join(tmpDir, "policy.yml");
  writeFileSync(policyPath, yamlStringify(basePolicy), "utf8");

  const onChain: OnChainPolicyRecord = {
    owner: agent.publicKey,
    agent: agent.publicKey,
    root: Array.from(policyRoot(basePolicy as never)),
    version: 1,
    revoked: false,
  };
  const fetcher: PolicyFetcher = {
    async ensureMatch() {},
    invalidateCache() {},
    async close() {},
  };
  void onChain;

  const rateLimiter = createInMemoryRateLimiter(agent.publicKey.toBase58());
  let activeSigner = new SentinelSigner({
    policyPath,
    agentKeypair: agent,
    registryProgramId: PROGRAM_ID,
    oracle: stubOracle,
    rateLimiter,
    policyFetcher: fetcher,
  });
  const signer = activeSigner;
  let escalationApproved = false;

  const sentinelFetch = createSentinelFetch({
    signer,
    paymentBuilder: createStubPaymentBuilder({ agent }),
    onEscalate: async (ticket) => {
      console.log(`[escalate] ${ticket.reason}`);
      if (process.env.AUTO_APPROVE !== "1") return "reject";
      if (!escalationApproved) {
        // Simulate a human approval by relaxing the escalation threshold,
        // then hot-swapping signer methods so retry passes.
        const approvedPolicy = {
          ...basePolicy,
          escalate_above: { usd_value: 999_999 },
        };
        writeFileSync(policyPath, yamlStringify(approvedPolicy), "utf8");
        const replacement = new SentinelSigner({
          policyPath,
          agentKeypair: agent,
          registryProgramId: PROGRAM_ID,
          oracle: stubOracle,
          rateLimiter,
          policyFetcher: fetcher,
        });
        (signer as unknown as { signTransaction: SentinelSigner["signTransaction"] }).signTransaction =
          replacement.signTransaction.bind(replacement);
        (
          signer as unknown as { signAllTransactions: SentinelSigner["signAllTransactions"] }
        ).signAllTransactions = replacement.signAllTransactions.bind(replacement);
        activeSigner = replacement;
        escalationApproved = true;
      }
      return "approve";
    },
  });

  for (const path of ["/cheap", "/expensive", "/blocked"]) {
    process.stdout.write(`GET ${path} … `);
    try {
      const res = await sentinelFetch(`${SERVER}${path}`);
      console.log(`${res.status} ${res.statusText}`);
    } catch (err) {
      console.log(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  await activeSigner.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
