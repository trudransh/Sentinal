// A2 helper: fire a real register_policy tx against the deployed devnet program.
// Once it confirms, Helius should deliver an enhanced webhook to the dashboard
// and a row should land in policy_events. That closes the A2 verification gate.
//
// Required env (from .env or shell):
//   SENTINEL_PROGRAM_ID        — deployed program (Anchor.toml)
//   SOLANA_RPC_URL             — devnet RPC, defaults to api.devnet.solana.com
//   SENTINEL_OWNER_KEYPAIR     — path to the owner keypair JSON. Defaults to
//                                ~/.config/solana/sentinel-dev.json (Anchor.toml
//                                provider.wallet).
//   SENTINEL_AGENT_KEYPAIR     — optional, path to an agent keypair JSON. If
//                                missing, generates a fresh one and writes it
//                                to .data/agent-<short>.json so future runs
//                                target the same PDA.
//
// Run: pnpm tsx scripts/probes/fire-register-policy.ts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";

import { loadDotEnv } from "./load-env";

loadDotEnv();

const programIdStr =
  process.env.SENTINEL_PROGRAM_ID ?? process.env.SENTINEL_REGISTRY_PROGRAM_ID;
const rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const ownerKpPath =
  process.env.SENTINEL_OWNER_KEYPAIR ??
  join(homedir(), ".config", "solana", "sentinel-dev.json");
const agentKpPath = process.env.SENTINEL_AGENT_KEYPAIR;

if (!programIdStr) {
  console.error("[fire] missing SENTINEL_PROGRAM_ID (or SENTINEL_REGISTRY_PROGRAM_ID)");
  process.exit(1);
}
if (!existsSync(ownerKpPath)) {
  console.error(
    `[fire] owner keypair not found at ${ownerKpPath}. Set SENTINEL_OWNER_KEYPAIR or generate one.`,
  );
  process.exit(1);
}

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function persistAgentKp(kp: Keypair): string {
  const short = kp.publicKey.toBase58().slice(0, 8);
  // Walk up from this script to the repo root so the keypair lands in a
  // predictable place regardless of cwd (pnpm sometimes chdirs).
  const repoRoot = resolve(new URL(".", import.meta.url).pathname, "..", "..");
  const out = resolve(repoRoot, `.data/agent-${short}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`[fire] persisted fresh agent keypair → ${out}`);
  return out;
}

// register_policy discriminator from the IDL (keep in sync if you regenerate)
const REGISTER_POLICY_DISCRIMINATOR = Buffer.from([
  62, 66, 167, 36, 252, 227, 38, 132,
]);

async function main() {
  const programId = new PublicKey(programIdStr!);
  const owner = loadKeypair(ownerKpPath);

  let agent: Keypair;
  if (agentKpPath && existsSync(agentKpPath)) {
    agent = loadKeypair(agentKpPath);
  } else {
    agent = Keypair.generate();
    persistAgentKp(agent);
  }

  // 32-byte placeholder root. The on-chain registry stores it verbatim — for
  // the A2 ingest probe, content doesn't matter. For demos, swap with the real
  // sha256 of a canonical policy YAML.
  const root = createHash("sha256").update(randomBytes(32)).digest();

  const [policyPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("policy"), agent.publicKey.toBuffer()],
    programId,
  );

  const conn = new Connection(rpcUrl, "confirmed");
  console.log(`[fire] program  : ${programId.toBase58()}`);
  console.log(`[fire] owner    : ${owner.publicKey.toBase58()}`);
  console.log(`[fire] agent    : ${agent.publicKey.toBase58()}`);
  console.log(`[fire] policyPda: ${policyPda.toBase58()}`);
  console.log(`[fire] root     : ${root.toString("hex")}`);

  // Args layout (Anchor): discriminator || agent (32) || root (32)
  const data = Buffer.concat([
    REGISTER_POLICY_DISCRIMINATOR,
    agent.publicKey.toBuffer(),
    root,
  ]);

  const ix = new TransactionInstruction({
    programId,
    keys: [
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },
      { pubkey: policyPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  console.log("[fire] sending register_policy…");
  const sig = await sendAndConfirmTransaction(conn, tx, [owner], {
    commitment: "confirmed",
    skipPreflight: false,
  });
  console.log(`[fire] confirmed: ${sig}`);
  console.log(`[fire] explorer:  https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  console.log(
    "[fire] now check the dashboard's policy_events table — Helius should deliver within ~5s.",
  );
}

main().catch((err: unknown) => {
  console.error("[fire] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
