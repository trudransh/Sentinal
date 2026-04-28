// Sentinel x Zerion policy bridge.
//
// Zerion's policy dispatcher loads this file from
// ~/.config/zerion/policies/ and calls `check(ctx)` on every outbound tx.
// We delegate to @sentinel/policy-dsl so the same rule engine governs both
// the direct signer-shim path and the Zerion path.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";

import { evaluate, parsePolicy } from "@sentinel/policy-dsl";
import { adaptCtx } from "./adapter.js";

const POLICY_PATH =
  process.env.SENTINEL_POLICY_PATH ?? join(homedir(), ".config", "sentinel", "policy.yml");

let cachedPolicy = null;
let cachedAt = 0;
const POLICY_TTL_MS = 30_000;

function loadPolicy() {
  const now = Date.now();
  if (cachedPolicy && now - cachedAt < POLICY_TTL_MS) return cachedPolicy;
  const yaml = readFileSync(POLICY_PATH, "utf8");
  cachedPolicy = parsePolicy(parseYaml(yaml));
  cachedAt = now;
  return cachedPolicy;
}

const noopHistory = {
  spentInWindow: () => 0,
  txCountInWindow: () => 0,
};

export async function check(ctx) {
  let policy;
  try {
    policy = loadPolicy();
  } catch (err) {
    return { allow: false, reason: `Sentinel: failed to load policy at ${POLICY_PATH}: ${err.message}` };
  }

  let summaries;
  try {
    summaries = adaptCtx(ctx, { agent: policy.agent });
  } catch (err) {
    return { allow: false, reason: `Sentinel: ctx adapter error: ${err.message}` };
  }

  if (summaries === null) {
    // Non-Solana chain — defer to Zerion's own EVM rules.
    return { allow: true };
  }

  const now = Date.now();
  for (const tx of summaries) {
    const verdict = evaluate({ policy, tx, history: noopHistory, now });
    if (verdict.type === "deny") {
      return { allow: false, reason: `Sentinel deny: ${verdict.reason}` };
    }
    if (verdict.type === "escalate") {
      return { allow: false, reason: `Sentinel escalate: ${verdict.reason}` };
    }
  }
  return { allow: true };
}

export default { check };
