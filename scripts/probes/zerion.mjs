// A5 probe: drop into ~/.config/zerion/policies/ as sentinel-probe.mjs
// to capture the real Zerion ctx shape.
//
// Install:
//   cp scripts/probes/zerion.mjs ~/.config/zerion/policies/sentinel-probe.mjs
// Then run any zerion-cli Solana command and read:
//   cat /tmp/sentinel-zerion-ctx.json | jq .

import { writeFileSync } from "node:fs";

const DUMP_PATH = process.env.SENTINEL_PROBE_DUMP ?? "/tmp/sentinel-zerion-ctx.json";

export async function check(ctx) {
  try {
    writeFileSync(
      DUMP_PATH,
      JSON.stringify(ctx, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
    );
    console.error(`[sentinel-probe] wrote ctx → ${DUMP_PATH}`);
  } catch (err) {
    console.error(`[sentinel-probe] dump failed: ${err.message}`);
  }
  return {
    allow: false,
    reason: "Sentinel probe — see /tmp/sentinel-zerion-ctx.json then remove this file",
  };
}

export default { check };
