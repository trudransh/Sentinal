// A6 probe: hit Dune SIM /beta/svm/balances for a real devnet agent and
// dump the response shape. Confirms our /api/balance proxy assumptions.
//
// Required env: SIM_API_KEY, AGENT_ADDRESS (devnet pubkey)
// Run: pnpm tsx scripts/probes/sim.ts

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadDotEnv } from "./load-env";

loadDotEnv();

const apiKey = process.env.SIM_API_KEY;
const address = process.env.AGENT_ADDRESS;

if (!apiKey || !address) {
  console.error("[sim] need SIM_API_KEY and AGENT_ADDRESS");
  process.exit(1);
}

async function main() {
  const url = `https://api.sim.dune.com/v1/svm/balances/${address}`;
  console.log(`[sim] GET ${url}`);
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "X-Sim-Api-Key": apiKey! } });
  const elapsed = Date.now() - t0;
  const text = await res.text();
  if (!res.ok) {
    console.error(`[sim] failed (${res.status}) in ${elapsed}ms:`, text);
    process.exit(1);
  }
  console.log(`[sim] ok in ${elapsed}ms`);

  const out = resolve("docs/sim-response.md");
  mkdirSync(dirname(out), { recursive: true });
  const md = [
    "# Dune SIM — /v1/svm/balances response shape",
    "",
    `Probed: ${new Date().toISOString()}`,
    `Address: \`${address}\` · elapsed: ${elapsed}ms`,
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(JSON.parse(text), null, 2),
    "```",
    "",
  ].join("\n");
  writeFileSync(out, md);
  console.log(`[sim] wrote ${out}`);
}

main().catch((err) => {
  console.error("[sim] probe failed:", err);
  process.exit(1);
});
