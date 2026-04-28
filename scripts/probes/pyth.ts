// A4 probe: hit live Pyth Hermes for SOL_USD and dump the response shape so
// we can verify our oracle assumptions match reality before the demo.
//
// Run: pnpm tsx scripts/probes/pyth.ts
// Output: docs/pyth-response.md (created on success)

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadDotEnv } from "./load-env";

loadDotEnv();

const HERMES_URL = process.env.HERMES_URL ?? "https://hermes.pyth.network";
const SOL_USD_FEED = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

async function main() {
  const out = resolve("docs/pyth-response.md");
  mkdirSync(dirname(out), { recursive: true });

  const { HermesClient } = await import("@pythnetwork/hermes-client");
  // The client typings are loose at the time of writing; cast to any once
  // for the probe and don't propagate.
  const h = new (HermesClient as unknown as new (
    url: string,
    opts: Record<string, unknown>,
  ) => {
    getLatestPriceUpdates(ids: string[]): Promise<unknown>;
  })(HERMES_URL, {});

  console.log(`[pyth] querying ${HERMES_URL} for SOL_USD…`);
  const t0 = Date.now();
  const res = await h.getLatestPriceUpdates([SOL_USD_FEED]);
  const elapsed = Date.now() - t0;
  console.log(`[pyth] ok in ${elapsed}ms`);

  const md = [
    "# Pyth Hermes — SOL_USD response shape",
    "",
    `Probed: ${new Date().toISOString()}`,
    `Endpoint: \`${HERMES_URL}\` · feed: \`${SOL_USD_FEED}\` · elapsed: ${elapsed}ms`,
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(res, null, 2),
    "```",
    "",
  ].join("\n");

  writeFileSync(out, md);
  console.log(`[pyth] wrote ${out}`);
}

main().catch((err) => {
  console.error("[pyth] probe failed:", err);
  process.exit(1);
});
