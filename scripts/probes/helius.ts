// A2 probe: register a Helius enhanced webhook against the deployed
// program. Run AFTER A1 (devnet deploy).
//
// Required env:
//   HELIUS_API_KEY            — from https://dev.helius.xyz
//   SENTINEL_PROGRAM_ID       — committed in lib.rs / Anchor.toml
//   (or SENTINEL_REGISTRY_PROGRAM_ID for compatibility)
//   TUNNEL_URL                — your cloudflared / ngrok URL
//   HELIUS_WEBHOOK_SECRET     — random string the dashboard validates
//
// Run: pnpm tsx scripts/probes/helius.ts

import { loadDotEnv } from "./load-env";

loadDotEnv();

const programId = process.env.SENTINEL_PROGRAM_ID ?? process.env.SENTINEL_REGISTRY_PROGRAM_ID;
const required = ["HELIUS_API_KEY", "TUNNEL_URL", "HELIUS_WEBHOOK_SECRET"];
const missing = required.filter((k) => !process.env[k]);
if (!programId) missing.push("SENTINEL_PROGRAM_ID (or SENTINEL_REGISTRY_PROGRAM_ID)");
if (missing.length) {
  console.error(`[helius] missing env (.env or shell): ${missing.join(", ")}`);
  process.exit(1);
}

const apiKey = process.env.HELIUS_API_KEY!;
const tunnel = process.env.TUNNEL_URL!.replace(/\/$/, "");
const secret = process.env.HELIUS_WEBHOOK_SECRET!;

async function main() {
  const url = `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`;
  const body = {
    webhookURL: `${tunnel}/api/webhook`,
    transactionTypes: ["ANY"],
    accountAddresses: [programId],
    webhookType: "enhanced",
    authHeader: secret,
  };

  console.log(`[helius] registering webhook → ${body.webhookURL}`);
  console.log(`[helius] watching program: ${programId}`);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`[helius] failed (${res.status}):`, text);
    process.exit(1);
  }

  const json = JSON.parse(text) as { webhookID?: string };
  console.log(`[helius] ok — webhookID=${json.webhookID ?? "(unknown)"}`);
  console.log("[helius] next: run `anchor test --skip-local-validator` to fire register_policy");
  console.log("        then check policy_events table for the row");
}

main().catch((err) => {
  console.error("[helius] probe failed:", err);
  process.exit(1);
});
