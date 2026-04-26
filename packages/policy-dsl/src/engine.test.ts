import { describe, expect, it } from "vitest";
import { evaluate, noopHistory, type SpendHistory } from "./engine.js";
import { parsePolicy, type Policy } from "./schema.js";
import type { Token, TxSummary } from "./types.js";

const AGENT = "AGENTPubKEy11111111111111111111111111111111";
const ALICE = "Alice111111111111111111111111111111111111111";
const BOB = "Bob11111111111111111111111111111111111111111";
const TREASURY = "Treasury111111111111111111111111111111111111";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SWAP_PROGRAM = "Swap1111111111111111111111111111111111111111";

const NOW = 1_700_000_000_000;

function tx(over: Partial<TxSummary> = {}): TxSummary {
  return {
    agent: AGENT,
    token: "SOL",
    amount: 0.1,
    destination: ALICE,
    programId: SYSTEM_PROGRAM,
    usdValue: 10,
    timestamp: NOW,
    ...over,
  };
}

function pol(over: Record<string, unknown>): Policy {
  return parsePolicy({ version: 1, agent: AGENT, ...over });
}

const fixedHistory = (
  spent: Partial<Record<string, number>>,
  count = 0,
): SpendHistory => ({
  spentInWindow(token: Token, _w: number, _n: number) {
    const key = token === "SOL" ? "SOL" : token === "USDC" ? "USDC" : token.mint;
    return spent[key] ?? 0;
  },
  txCountInWindow: () => count,
});

describe("engine: 15 mandated fixtures", () => {
  // ── 5 ALLOWS ────────────────────────────────────────────────────────────
  it("1. empty policy + simple SOL transfer → allow", () => {
    const v = evaluate({
      policy: pol({}),
      tx: tx(),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("allow");
  });

  it("2. USDC transfer under USDC cap → allow", () => {
    const v = evaluate({
      policy: pol({ caps: [{ token: "USDC", max_per_day: 50 }] }),
      tx: tx({ token: "USDC", amount: 5 }),
      history: fixedHistory({ USDC: 0 }),
      now: NOW,
    });
    expect(v.type).toBe("allow");
  });

  it("12. all rules pass, no escalate threshold → allow", () => {
    const v = evaluate({
      policy: pol({
        caps: [{ token: "SOL", max_per_day: 1 }],
        allowlist: { destinations: [ALICE] },
        programs: { allow: [SYSTEM_PROGRAM] },
        rate_limit: { max_tx_per_minute: 10 },
      }),
      tx: tx(),
      history: fixedHistory({ SOL: 0 }, 3),
      now: NOW,
    });
    expect(v.type).toBe("allow");
  });

  it("14. caps unset, allowlist passes → allow", () => {
    const v = evaluate({
      policy: pol({ allowlist: { destinations: [ALICE] } }),
      tx: tx(),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("allow");
  });

  it("15. rate-limit window crosses minute boundary → allow when sliding", () => {
    const slidingHistory: SpendHistory = {
      spentInWindow: () => 0,
      txCountInWindow: (windowMs) => (windowMs >= 60_000 ? 0 : 5),
    };
    const v = evaluate({
      policy: pol({ rate_limit: { max_tx_per_minute: 5 } }),
      tx: tx(),
      history: slidingHistory,
      now: NOW,
    });
    expect(v.type).toBe("allow");
  });

  // ── 5 DENIES ────────────────────────────────────────────────────────────
  it("3. destination on denylist → deny", () => {
    const v = evaluate({
      policy: pol({ denylist: { destinations: [ALICE] } }),
      tx: tx({ destination: ALICE }),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("deny");
    if (v.type === "deny") expect(v.reason).toMatch(/denylist/);
  });

  it("4. destination not on allowlist → deny", () => {
    const v = evaluate({
      policy: pol({ allowlist: { destinations: [TREASURY] } }),
      tx: tx({ destination: BOB }),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("deny");
    if (v.type === "deny") expect(v.reason).toMatch(/allowlist/);
  });

  it("5. program not on allow list → deny", () => {
    const v = evaluate({
      policy: pol({ programs: { allow: [TOKEN_PROGRAM] } }),
      tx: tx({ programId: SWAP_PROGRAM }),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("deny");
    if (v.type === "deny") expect(v.reason).toMatch(/programs\.allow/);
  });

  it("6. max_per_tx exceeded → deny", () => {
    const v = evaluate({
      policy: pol({ caps: [{ token: "SOL", max_per_tx: 0.05 }] }),
      tx: tx({ amount: 0.1 }),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("deny");
    if (v.type === "deny") expect(v.reason).toMatch(/max_per_tx/);
  });

  it("7. max_per_day exceeded by 0.01 → deny", () => {
    const v = evaluate({
      policy: pol({ caps: [{ token: "USDC", max_per_day: 50 }] }),
      tx: tx({ token: "USDC", amount: 0.01 }),
      history: fixedHistory({ USDC: 50 }),
      now: NOW,
    });
    expect(v.type).toBe("deny");
    if (v.type === "deny") expect(v.reason).toMatch(/max_per_day/);
  });

  it("8. max_per_hour exceeded by 0.01 → deny", () => {
    const v = evaluate({
      policy: pol({ caps: [{ token: "USDC", max_per_hour: 5 }] }),
      tx: tx({ token: "USDC", amount: 0.01 }),
      history: fixedHistory({ USDC: 5 }),
      now: NOW,
    });
    expect(v.type).toBe("deny");
    if (v.type === "deny") expect(v.reason).toMatch(/max_per_hour/);
  });

  it("9. max_tx_per_minute exceeded → deny", () => {
    const v = evaluate({
      policy: pol({ rate_limit: { max_tx_per_minute: 5 } }),
      tx: tx(),
      history: fixedHistory({}, 5),
      now: NOW,
    });
    expect(v.type).toBe("deny");
    if (v.type === "deny") expect(v.reason).toMatch(/max_tx_per_minute/);
  });

  it("13. allowlist + denylist conflict (denylist wins) → deny", () => {
    const v = evaluate({
      policy: pol({
        allowlist: { destinations: [ALICE] },
        denylist: { destinations: [ALICE] },
      }),
      tx: tx({ destination: ALICE }),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("deny");
    if (v.type === "deny") expect(v.reason).toMatch(/denylist/);
  });

  // ── 3 ESCALATES ─────────────────────────────────────────────────────────
  it("10. stale oracle (Infinity) + escalate threshold set → escalate", () => {
    const v = evaluate({
      policy: pol({ escalate_above: { usd_value: 1 } }),
      tx: tx({ usdValue: Number.POSITIVE_INFINITY }),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("escalate");
    if (v.type === "escalate") expect(v.reason).toMatch(/stale/i);
  });

  it("11. escalate_above.usd_value exceeded by $1 → escalate", () => {
    const v = evaluate({
      policy: pol({ escalate_above: { usd_value: 5 } }),
      tx: tx({ usdValue: 6 }),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("escalate");
    if (v.type === "escalate") expect(v.reason).toMatch(/usd_value/);
  });

  it("escalate skipped when threshold unset (sanity)", () => {
    const v = evaluate({
      policy: pol({}),
      tx: tx({ usdValue: 1_000_000 }),
      history: noopHistory,
      now: NOW,
    });
    expect(v.type).toBe("allow");
  });
});
