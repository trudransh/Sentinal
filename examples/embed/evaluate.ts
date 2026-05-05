// C5: 5-line standalone embed of @sentinel/policy-dsl
// Run: npx tsx examples/embed/evaluate.ts
//
// This shows how any app can drop in Sentinel's policy engine
// without the full signer-shim stack.

import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { evaluate, parsePolicy, policyRootHex, noopHistory } from "@sentinel/policy-dsl";
import type { TxSummary } from "@sentinel/policy-dsl";

// 1. Load any policy YAML
const policy = parsePolicy(parseYaml(readFileSync("examples/policies/small.yml", "utf8")));
console.log("policy root:", policyRootHex(policy));

// 2. Build a transaction summary (in production this comes from tx-parser)
const tx: TxSummary = {
  agent: policy.agent,
  token: "SOL",
  amount: 0.3,
  destination: "11111111111111111111111111111111",
  programId: "11111111111111111111111111111111",
  usdValue: 25,
  timestamp: Date.now(),
};

// 3. Evaluate — one function call, pure & deterministic
const verdict = evaluate({ policy, tx, history: noopHistory, now: Date.now() });

console.log("verdict:", verdict);
// → { type: "allow" }  (0.3 SOL < 0.5 SOL/day cap)

// 4. Try exceeding the cap
const bigTx: TxSummary = { ...tx, amount: 0.6, usdValue: 50 };
const denied = evaluate({ policy, tx: bigTx, history: noopHistory, now: Date.now() });
console.log("denied: ", denied);
// → { type: "deny", reason: "caps[0].max_per_tx exceeded: ..." }
