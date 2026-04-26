import { describe, expect, it } from "vitest";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import type { TxSummary } from "@sentinel/policy-dsl";

const AGENT = "AGENTPubKEy11111111111111111111111111111111";

function tx(amount: number, ts: number, token: TxSummary["token"] = "USDC"): TxSummary {
  return {
    agent: AGENT,
    token,
    amount,
    destination: "Dest1111111111111111111111111111111111111111",
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    usdValue: amount,
    timestamp: ts,
  };
}

describe("rate-limiter (sqlite, in-memory)", () => {
  it("counts 5 of 10 inserts within a 5-tx/min window", () => {
    const rl = createInMemoryRateLimiter(AGENT);
    try {
      const t0 = 1_700_000_000_000;
      for (let i = 0; i < 10; i++) rl.record(tx(0.1, t0 + i * 1000));
      const count = rl.txCountInWindow(60_000, t0 + 10_000);
      expect(count).toBe(10);
    } finally {
      rl.close();
    }
  });

  it("sums spent in window per token", () => {
    const rl = createInMemoryRateLimiter(AGENT);
    try {
      const t0 = 1_700_000_000_000;
      rl.record(tx(2, t0));
      rl.record(tx(3, t0 + 1000));
      rl.record(tx(0.5, t0 + 2000, "SOL"));
      expect(rl.spentInWindow("USDC", 60_000, t0 + 5000)).toBeCloseTo(5);
      expect(rl.spentInWindow("SOL", 60_000, t0 + 5000)).toBeCloseTo(0.5);
    } finally {
      rl.close();
    }
  });

  it("excludes entries outside the window", () => {
    const rl = createInMemoryRateLimiter(AGENT);
    try {
      const t0 = 1_700_000_000_000;
      rl.record(tx(10, t0));
      rl.record(tx(1, t0 + 30 * 60_000));
      const spent = rl.spentInWindow("USDC", 60_000, t0 + 30 * 60_000 + 100);
      expect(spent).toBeCloseTo(1);
    } finally {
      rl.close();
    }
  });

  it("prune removes old rows", () => {
    const rl = createInMemoryRateLimiter(AGENT);
    try {
      const t0 = 1_700_000_000_000;
      rl.record(tx(1, t0));
      rl.record(tx(1, t0 + 1000));
      rl.prune(t0 + 500);
      expect(rl.txCountInWindow(10 * 60_000, t0 + 2000)).toBe(1);
    } finally {
      rl.close();
    }
  });
});
