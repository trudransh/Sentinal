import { describe, expect, it, beforeAll } from "vitest";
import { classifyTx, type HeliusEnhancedTx } from "./helius";

// Configure decoder for the deployed devnet program before importing the module.
// Vitest doesn't isolate process.env per file; this is set once for the suite.
beforeAll(() => {
  process.env.SENTINEL_PROGRAM_ID =
    process.env.SENTINEL_PROGRAM_ID ?? "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk";
});

// Captured 2026-04-28T16:54:49Z from a real register_policy devnet tx.
// See docs/helius-payload.md for provenance.
const REAL_REGISTER_PAYLOAD: HeliusEnhancedTx = {
  signature:
    "kVBhPzzSyaE2v1kV69uAvrJGCKFWGzX33Nn9jdhJZYGKLvJY3yHirhmj8KBfn3UNuJ8AjSuZGPmB5MSpgnT8rqg",
  feePayer: "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ",
  events: {},
  description: "",
  source: "UNKNOWN",
  type: "UNKNOWN",
  accountData: [
    { account: "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ", nativeBalanceChange: -2468840 },
    { account: "3qezYWDRvVzu8g75EgFT5nqL5nou5BfQiWpiuQdgTdcS", nativeBalanceChange: 2463840 },
    { account: "11111111111111111111111111111111", nativeBalanceChange: 0 },
    { account: "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk", nativeBalanceChange: 0 },
  ],
  instructions: [
    {
      accounts: [
        "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ",
        "3qezYWDRvVzu8g75EgFT5nqL5nou5BfQiWpiuQdgTdcS",
        "11111111111111111111111111111111",
      ],
      data: "vJSveqwuJNztqp4F2wnMAckx62dEwkvL8rPeNi7ZpcY2jPTRhu9T1ALCYpPCyKyhLZDV6PMDibozh5o5xGUcyAvY96xnjzxXye",
      programId: "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk",
    },
  ],
};

describe("classifyTx (C3)", () => {
  it("decodes a real register_policy payload from instruction data", () => {
    const decoded = classifyTx(REAL_REGISTER_PAYLOAD);
    expect(decoded.kind).toBe("registered");
    expect(decoded.agent).not.toBe("unknown");
    expect(decoded.agent).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(decoded.policyPda).toBe("3qezYWDRvVzu8g75EgFT5nqL5nou5BfQiWpiuQdgTdcS");
    expect(decoded.owner).toBe("UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ");
    expect(decoded.rootHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns unknown for txs that don't touch the configured program", () => {
    const otherProg: HeliusEnhancedTx = {
      signature: "x",
      instructions: [
        {
          programId: "11111111111111111111111111111111",
          data: "11", // some random b58
          accounts: [],
        },
      ],
    };
    const decoded = classifyTx(otherProg);
    expect(decoded.kind).toBe("unknown");
    expect(decoded.agent).toBe("unknown");
  });

  it("returns unknown when an ix's data has the wrong discriminator", () => {
    // Same shape as register but data starts with non-discriminator bytes.
    const garbled: HeliusEnhancedTx = {
      signature: "x",
      instructions: [
        {
          programId: "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk",
          data: "11111111", // 6 zero-bytes after leading-1 conversion → not a known discriminator
          accounts: [
            "UBKRkqqohyRWhifKFFmm65RcWBNb17gfga1c7N2F7DQ",
            "3qezYWDRvVzu8g75EgFT5nqL5nou5BfQiWpiuQdgTdcS",
          ],
        },
      ],
    };
    const decoded = classifyTx(garbled);
    expect(decoded.kind).toBe("unknown");
  });

  it("does not throw on adversarial / malformed instruction data", () => {
    const bad: HeliusEnhancedTx = {
      signature: "x",
      instructions: [
        {
          programId: "2fQyCvg9MgiribMmXbXwn4oq587Kqo3cNGCh4x7BRVCk",
          data: "Iil0O", // contains base58-illegal chars (I, l, 0, O)
          accounts: [],
        },
      ],
    };
    expect(() => classifyTx(bad)).not.toThrow();
    expect(classifyTx(bad).kind).toBe("unknown");
  });
});
