// A3 verification gate: live x402 payment on devnet.
//
// Spins up a local x402-protected demo server (with on-chain payment
// verification), constructs a SentinelSigner using the existing devnet agent
// keypair, runs createSentinelFetch through the LivePaymentBuilder, and
// asserts the returned response is 200 (which only happens after the server
// has verified the signature is confirmed on devnet).
//
// Required env (from .env):
//   - HELIUS_API_KEY  (used for the RPC URL via app/lib/rpc.ts pattern)
//   - SENTINEL_AGENT_KEYPAIR (path to the funded devnet agent keypair JSON;
//     defaults to .data/agent-88y2ZvQn.json which fire-register-policy created
//     and you've since funded with 5.5 SOL)
//
// Run: pnpm tsx scripts/probes/x402-live.ts

import { readFileSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify as yamlStringify } from "yaml";
import { createServer, type Server } from "node:http";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import express from "express";

import { policyRoot } from "@sentinel/policy-dsl";
import {
  SentinelSigner,
  createInMemoryRateLimiter,
  stubOracle,
  type PolicyFetcher,
} from "@sentinel/signer-shim";
import {
  createSentinelFetch,
  createLivePaymentBuilder,
  x402Protect,
} from "@sentinel/x402-interceptor";

import { loadDotEnv } from "./load-env";

loadDotEnv();

const PROGRAM_ID = new PublicKey(
  process.env.SENTINEL_PROGRAM_ID ??
    process.env.SENTINEL_REGISTRY_PROGRAM_ID ??
    "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk",
);

function resolveRpcUrl(): string {
  const override = process.env.SOLANA_RPC_URL;
  if (override && !override.includes("api.devnet.solana.com")) return override;
  const heliusKey = process.env.HELIUS_API_KEY;
  if (heliusKey) return `https://devnet.helius-rpc.com/?api-key=${heliusKey}`;
  return override ?? "https://api.devnet.solana.com";
}

function loadKeypair(path: string): Keypair {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const rpcUrl = resolveRpcUrl();
  const conn = new Connection(rpcUrl, "confirmed");
  console.log(`[x402-live] RPC: ${rpcUrl.replace(/api-key=[^&]+/, "api-key=***")}`);

  const agentKpPath =
    process.env.SENTINEL_AGENT_KEYPAIR ?? ".data/agent-7BQ1jaQh.json";
  if (!existsSync(agentKpPath)) {
    console.error(
      `[x402-live] agent keypair not found at ${agentKpPath}. ` +
        `Run 'pnpm fire:register-policy' first or set SENTINEL_AGENT_KEYPAIR.`,
    );
    process.exit(1);
  }
  const agent = loadKeypair(agentKpPath);
  console.log(`[x402-live] agent: ${agent.publicKey.toBase58()}`);

  // Sanity: the agent needs SOL on devnet to pay for the transfer + fee.
  const balLamports = await conn.getBalance(agent.publicKey, "confirmed");
  console.log(`[x402-live] balance: ${(balLamports / 1_000_000_000).toFixed(6)} SOL`);
  if (balLamports < 10_000_000) {
    console.error(
      `[x402-live] agent has < 0.01 SOL — fund with 'solana airdrop 1 ${agent.publicKey.toBase58()} --url devnet'`,
    );
    process.exit(1);
  }

  // Treasury = a fresh keypair we don't care about (just so we can confirm the
  // transfer landed). Could also be the registry owner.
  const treasury = Keypair.generate();
  console.log(`[x402-live] treasury: ${treasury.publicKey.toBase58()}`);

  // 1. SentinelSigner with policy that allows the SOL transfer to the treasury.
  const policy = {
    version: 1,
    agent: agent.publicKey.toBase58(),
    caps: [{ token: "SOL", max_per_tx: 0.5 }],
    allowlist: { destinations: [treasury.publicKey.toBase58()] },
    escalate_above: { usd_value: 1000 }, // way above 0.001 SOL × $100
  };
  const tmpDir = mkdtempSync(join(tmpdir(), "x402-live-"));
  const policyPath = join(tmpDir, "policy.yml");
  writeFileSync(policyPath, yamlStringify(policy), "utf8");

  // We're not registering this policy on-chain here — use a permissive fetcher
  // that always matches. (The on-chain root path is exercised end-to-end in the
  // dashboard; for the x402 verification gate we only need a clean signing flow.)
  void policyRoot(policy as never);
  const fetcher: PolicyFetcher = {
    async ensureMatch() {},
    invalidateCache() {},
    async close() {},
  };

  const signer = new SentinelSigner({
    policyPath,
    agentKeypair: agent,
    registryProgramId: PROGRAM_ID,
    oracle: stubOracle,
    rateLimiter: createInMemoryRateLimiter(agent.publicKey.toBase58()),
    policyFetcher: fetcher,
  });

  // 2. demo server with on-chain verifyOnChain.
  const PORT = 4422;
  const app = express();
  app.use(express.json());
  app.get(
    "/cheap-sol",
    x402Protect({
      receivingAddress: treasury.publicKey.toBase58(),
      pricePerCall: { token: "SOL", amount: 0.001 },
      description: "live x402 SOL endpoint (devnet)",
      verifyOnChain: { connection: conn, commitment: "confirmed" },
    }),
    (_req, res) => {
      res.json({ data: "live data, paid for", price: "0.001 SOL" });
    },
  );

  const server = await new Promise<Server>((resolveStart) => {
    const s = app.listen(PORT, () => {
      console.log(`[x402-live] server up on http://localhost:${PORT}`);
      resolveStart(s);
    });
  });

  try {
    // 3. live PaymentBuilder + sentinelFetch.
    const sentinelFetch = createSentinelFetch({
      signer,
      paymentBuilder: createLivePaymentBuilder({
        agent,
        connection: conn,
        logger: (m) => console.log(`  ${m}`),
      }),
    });

    console.log(`[x402-live] requesting GET /cheap-sol …`);
    const t0 = Date.now();
    const res = await sentinelFetch(`http://localhost:${PORT}/cheap-sol`);
    const elapsed = Date.now() - t0;
    const body = (await res.json()) as Record<string, unknown>;
    console.log(`[x402-live] response: ${res.status} ${res.statusText} (${elapsed}ms)`);
    console.log(`[x402-live] body: ${JSON.stringify(body)}`);
    if (res.status !== 200) {
      console.error("[x402-live] FAIL — expected 200 after payment");
      process.exit(2);
    }

    // Confirm the treasury actually received funds.
    const treasuryBal = await conn.getBalance(treasury.publicKey, "confirmed");
    console.log(
      `[x402-live] treasury received: ${(treasuryBal / 1_000_000_000).toFixed(9)} SOL`,
    );
    if (treasuryBal === 0) {
      console.error("[x402-live] FAIL — treasury balance is 0, transfer didn't land");
      process.exit(3);
    }

    console.log("");
    console.log("[x402-live] ✓ verification gate passed");
    console.log(
      "[x402-live]   demo client paid /cheap-sol → server verified sig on-chain → 200",
    );
  } finally {
    server.close();
    await signer.close();
  }
}

main().catch((err) => {
  console.error("[x402-live] failed:", err);
  process.exit(1);
});
