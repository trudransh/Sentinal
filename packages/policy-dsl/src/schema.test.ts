import { describe, expect, it } from "vitest";
import { InvalidPolicyError, parsePolicy } from "./schema.js";

const AGENT = "AGENTPubKEy11111111111111111111111111111111";

describe("schema: parsePolicy", () => {
  it("accepts a minimal valid policy", () => {
    const p = parsePolicy({ version: 1, agent: AGENT });
    expect(p.version).toBe(1);
    expect(p.agent).toBe(AGENT);
    expect(p.caps).toEqual([]);
  });

  it("rejects unknown top-level keys (.strict)", () => {
    expect(() => parsePolicy({ version: 1, agent: AGENT, foo: 1 })).toThrow(
      InvalidPolicyError,
    );
  });

  it("rejects wrong version", () => {
    expect(() => parsePolicy({ version: 2, agent: AGENT })).toThrow(InvalidPolicyError);
  });

  it("rejects negative caps", () => {
    expect(() =>
      parsePolicy({
        version: 1,
        agent: AGENT,
        caps: [{ token: "SOL", max_per_tx: -1 }],
      }),
    ).toThrow(InvalidPolicyError);
  });

  it("accepts mint-token caps", () => {
    const p = parsePolicy({
      version: 1,
      agent: AGENT,
      caps: [
        {
          token: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
          max_per_day: 1,
        },
      ],
    });
    expect(p.caps[0]?.token).toEqual({
      mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    });
  });
});
