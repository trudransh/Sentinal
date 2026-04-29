#!/usr/bin/env node
// C1: One-liner Zerion install UX
// Usage: npx @sentinel/zerion-bridge install
//
// Copies sentinel.mjs into ~/.config/zerion/policies/ and scaffolds
// a starter policy.yml if one doesn't exist yet.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "..", "src", "sentinel.mjs");
const ZERION_DIR = join(homedir(), ".config", "zerion", "policies");
const SENTINEL_DIR = join(homedir(), ".config", "sentinel");
const POLICY_PATH = join(SENTINEL_DIR, "policy.yml");
const TARGET = join(ZERION_DIR, "sentinel.mjs");

const STARTER_POLICY = `# Sentinel policy — edit to match your agent
# Docs: https://github.com/dracian/Sentinal/blob/main/packages/policy-dsl/README.md
version: 1
agent: YOUR_AGENT_PUBKEY_HERE
caps:
  - token: SOL
    max_per_tx: 1.0
    max_per_day: 5.0
  - token: USDC
    max_per_tx: 50
    max_per_day: 200
denylist:
  destinations: []
escalate_above:
  usd_value: 100
rate_limit:
  max_tx_per_minute: 10
`;

// ANSI colors
const G = "\x1b[32m";   // green
const C = "\x1b[36m";   // cyan
const Y = "\x1b[33m";   // yellow
const D = "\x1b[2m";    // dim
const R = "\x1b[0m";    // reset
const B = "\x1b[1m";    // bold

function main(): void {
  console.log("");
  console.log(`${B}${C}⬡ Sentinel × Zerion Bridge Installer${R}`);
  console.log(`${D}─────────────────────────────────────${R}`);
  console.log("");

  // 1. Install bridge script
  mkdirSync(ZERION_DIR, { recursive: true });
  copyFileSync(SOURCE, TARGET);
  console.log(`  ${G}✓${R} Bridge installed → ${D}${TARGET}${R}`);

  // 2. Scaffold starter policy if none exists
  mkdirSync(SENTINEL_DIR, { recursive: true });
  if (!existsSync(POLICY_PATH)) {
    writeFileSync(POLICY_PATH, STARTER_POLICY, "utf8");
    console.log(`  ${G}✓${R} Starter policy created → ${D}${POLICY_PATH}${R}`);
  } else {
    console.log(`  ${Y}○${R} Policy already exists → ${D}${POLICY_PATH}${R}`);
  }

  console.log("");
  console.log(`${B}Next steps:${R}`);
  console.log("");
  console.log(`  ${C}1.${R} Edit your policy YAML:`);
  console.log(`     ${D}$EDITOR ${POLICY_PATH}${R}`);
  console.log("");
  console.log(`  ${C}2.${R} Replace ${Y}YOUR_AGENT_PUBKEY_HERE${R} with your agent's pubkey`);
  console.log("");
  console.log(`  ${C}3.${R} Register with Zerion CLI:`);
  console.log(`     ${D}zerion-cli agent create-policy --scripts ${TARGET}${R}`);
  console.log("");
  console.log(`  ${C}4.${R} Test — run a swap in Zerion and watch Sentinel enforce your caps`);
  console.log("");
  console.log(`${D}Docs: https://github.com/dracian/Sentinal${R}`);
  console.log("");
}

main();
