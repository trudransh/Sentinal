import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { policyRootHex, canonicalJson } from "./canonicalize.js";
import { parsePolicy, type Policy } from "./schema.js";

const AGENT = "AGENTPubKEy11111111111111111111111111111111";
const D1 = "Dest1111111111111111111111111111111111111111";
const D2 = "Dest2222222222222222222222222222222222222222";

const base = (extra: Partial<Policy> = {}): Policy =>
  parsePolicy({
    version: 1,
    agent: AGENT,
    caps: [
      { token: "SOL", max_per_day: 1 },
      { token: "USDC", max_per_day: 50 },
    ],
    allowlist: { destinations: [D1, D2] },
    ...extra,
  });

describe("canonicalize: deterministic root", () => {
  it("differentKeyOrder: same policy with caps before vs after allowlist yields identical root", () => {
    const a = parsePolicy({
      version: 1,
      agent: AGENT,
      caps: [{ token: "SOL", max_per_day: 1 }],
      allowlist: { destinations: [D1] },
    });
    const b = parsePolicy({
      allowlist: { destinations: [D1] },
      caps: [{ token: "SOL", max_per_day: 1 }],
      agent: AGENT,
      version: 1,
    });
    expect(policyRootHex(a)).toBe(policyRootHex(b));
  });

  it("whitespace: same policy via different YAML formatting yields identical root", () => {
    const yamlA = `version: 1
agent: ${AGENT}
caps:
  - token: SOL
    max_per_day: 1
allowlist:
  destinations:
    - ${D1}
`;
    const yamlB = `version:    1
agent:    ${AGENT}
caps:
   - token:   SOL
     max_per_day:    1
allowlist:
   destinations:
      - ${D1}
`;
    const a = parsePolicy(parseYaml(yamlA));
    const b = parsePolicy(parseYaml(yamlB));
    expect(policyRootHex(a)).toBe(policyRootHex(b));
  });

  it("arrayOrder: caps order is semantic — different order ⇒ different root", () => {
    const a = parsePolicy({
      version: 1,
      agent: AGENT,
      caps: [
        { token: "SOL", max_per_day: 1 },
        { token: "USDC", max_per_day: 50 },
      ],
    });
    const b = parsePolicy({
      version: 1,
      agent: AGENT,
      caps: [
        { token: "USDC", max_per_day: 50 },
        { token: "SOL", max_per_day: 1 },
      ],
    });
    expect(policyRootHex(a)).not.toBe(policyRootHex(b));
  });

  it("policyRoot is 32 bytes", () => {
    const policy = base();
    const json = canonicalJson(policy);
    expect(json.length).toBeGreaterThan(0);
    expect(policyRootHex(policy)).toMatch(/^[0-9a-f]{64}$/);
  });
});
