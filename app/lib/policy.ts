import { parse as parseYaml } from "yaml";
import {
  parsePolicy,
  policyRootHex,
  type Policy,
} from "@sentinel/policy-dsl";

export function tryParseYamlPolicy(yaml: string): { ok: true; policy: Policy; rootHex: string } | { ok: false; error: string } {
  try {
    const parsed = parseYaml(yaml);
    const policy = parsePolicy(parsed);
    return { ok: true, policy, rootHex: policyRootHex(policy) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
