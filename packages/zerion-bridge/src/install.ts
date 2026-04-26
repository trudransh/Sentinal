#!/usr/bin/env node
import { copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(HERE, "..", "src", "sentinel.mjs");
const TARGET_DIR = join(homedir(), ".config", "zerion", "policies");
const TARGET = join(TARGET_DIR, "sentinel.mjs");

function main(): void {
  mkdirSync(TARGET_DIR, { recursive: true });
  copyFileSync(SOURCE, TARGET);
  console.log(`Installed Sentinel bridge → ${TARGET}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  1. Make sure your policy YAML is at $SENTINEL_POLICY_PATH (default: ~/.config/sentinel/policy.yml).`);
  console.log(`  2. Register with Zerion CLI, e.g.:`);
  console.log(`       zerion-cli agent create-policy --scripts ${TARGET}`);
  console.log(`  3. Run \`zerion-cli wallet …\` and confirm the policy fires.`);
}

main();
