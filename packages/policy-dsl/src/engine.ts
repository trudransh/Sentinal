import type { Policy, Cap } from "./schema.js";
import {
  type Token,
  type TxSummary,
  type Verdict,
  tokenLabel,
  tokensEqual,
} from "./types.js";

export interface SpendHistory {
  spentInWindow(token: Token, windowMs: number, nowMs: number): number;
  txCountInWindow(windowMs: number, nowMs: number): number;
}

export interface EvalContext {
  policy: Policy;
  tx: TxSummary;
  history: SpendHistory;
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const SOLANA_DECIMAL_PRECISION = 9;
const round9 = (n: number): number =>
  Math.round(n * 10 ** SOLANA_DECIMAL_PRECISION) / 10 ** SOLANA_DECIMAL_PRECISION;

export const noopHistory: SpendHistory = {
  spentInWindow: () => 0,
  txCountInWindow: () => 0,
};

const allow = (): Verdict => ({ type: "allow" });
const deny = (reason: string): Verdict => ({ type: "deny", reason });
const escalate = (reason: string): Verdict => ({ type: "escalate", reason });

export function evaluate(ctx: EvalContext): Verdict {
  const { policy, tx, history, now } = ctx;

  const denylist = policy.denylist?.destinations ?? [];
  if (denylist.includes(tx.destination)) {
    return deny(`denylist: destination ${tx.destination} blocked`);
  }

  const programAllow = policy.programs?.allow;
  if (programAllow && programAllow.length > 0 && !programAllow.includes(tx.programId)) {
    return deny(`programs.allow: program ${tx.programId} not allowlisted`);
  }

  const allowlist = policy.allowlist?.destinations ?? [];
  if (allowlist.length > 0 && !allowlist.includes(tx.destination)) {
    return deny(`allowlist: destination ${tx.destination} not allowlisted`);
  }

  for (let i = 0; i < policy.caps.length; i++) {
    const cap = policy.caps[i];
    if (!cap || !tokensEqual(cap.token, tx.token)) continue;
    const denial = checkCap(cap, i, tx, history, now);
    if (denial) return denial;
  }

  const rl = policy.rate_limit?.max_tx_per_minute;
  if (rl !== undefined) {
    const recent = history.txCountInWindow(MINUTE_MS, now);
    if (recent + 1 > rl) {
      return deny(`rate_limit.max_tx_per_minute exceeded: ${recent + 1} > ${rl}`);
    }
  }

  const usdThreshold = policy.escalate_above?.usd_value;
  if (usdThreshold !== undefined) {
    if (!Number.isFinite(tx.usdValue)) {
      return escalate(`escalate_above.usd_value: oracle stale, USD value unknown`);
    }
    if (tx.usdValue > usdThreshold) {
      return escalate(
        `escalate_above.usd_value exceeded: $${tx.usdValue.toFixed(2)} > $${usdThreshold}`,
      );
    }
  }

  return allow();
}

function checkCap(
  cap: Cap,
  index: number,
  tx: TxSummary,
  history: SpendHistory,
  now: number,
): Verdict | null {
  const amount = round9(tx.amount);
  const label = tokenLabel(cap.token);

  if (cap.max_per_tx !== undefined && amount > round9(cap.max_per_tx)) {
    return deny(
      `caps[${index}].max_per_tx exceeded: ${amount} ${label} > ${cap.max_per_tx} ${label}`,
    );
  }

  if (cap.max_per_hour !== undefined) {
    const spent = round9(history.spentInWindow(cap.token, HOUR_MS, now));
    const projected = round9(spent + amount);
    if (projected > round9(cap.max_per_hour)) {
      return deny(
        `caps[${index}].max_per_hour exceeded: ${projected} ${label} > ${cap.max_per_hour} ${label}`,
      );
    }
  }

  if (cap.max_per_day !== undefined) {
    const spent = round9(history.spentInWindow(cap.token, DAY_MS, now));
    const projected = round9(spent + amount);
    if (projected > round9(cap.max_per_day)) {
      return deny(
        `caps[${index}].max_per_day exceeded: ${projected} ${label} > ${cap.max_per_day} ${label}`,
      );
    }
  }

  return null;
}
