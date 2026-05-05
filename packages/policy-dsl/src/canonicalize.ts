import { createHash } from "node:crypto";
import stringify from "json-stable-stringify";
import { parsePolicy, type Policy } from "./schema.js";

export function canonicalJson(policy: Policy): string {
  // HARDEN: stringify the *parsed* policy, not the input. With strict zod
  // today this is identical, but if anyone loosens schemas to .passthrough()
  // the canonical bytes would otherwise include extra fields that the
  // signing path doesn't see — a hash drift bug waiting to happen.
  const validated = parsePolicy(policy);
  const out = stringify(validated as unknown as Record<string, unknown>, {
    space: "",
  });
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
