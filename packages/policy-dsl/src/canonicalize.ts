import { createHash } from "node:crypto";
import stringify from "json-stable-stringify";
import { parsePolicy, type Policy } from "./schema.js";

export function canonicalJson(policy: Policy): string {
  parsePolicy(policy);
  const out = stringify(policy as unknown as Record<string, unknown>, { space: "" });
  if (out === undefined) {
    throw new Error("canonicalJson: stringify returned undefined");
  }
  return out;
}

export function policyRoot(policy: Policy): Uint8Array {
  const json = canonicalJson(policy);
  return createHash("sha256").update(Buffer.from(json, "utf8")).digest();
}

export function policyRootHex(policy: Policy): string {
  return Buffer.from(policyRoot(policy)).toString("hex");
}
