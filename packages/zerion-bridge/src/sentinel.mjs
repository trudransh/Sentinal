// Sentinel x Zerion policy bridge.
//
// Zerion's policy dispatcher loads this file from
// ~/.config/zerion/policies/ and calls `check(ctx)` on every outbound tx.
// We delegate to @sentinel/policy-dsl so the same rule engine governs both
// the direct signer-shim path and the Zerion path.
//
// D2: Uses a real SQLite rate limiter (shared via DATABASE_PATH env) so that
// caps and rate_limit rules are enforced — noopHistory silently bypassed them.

import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";

import { evaluate, parsePolicy } from "@sentinel/policy-dsl";
import { adaptCtx } from "./adapter.js";

// D2: Lazy-loaded SQLite rate limiter. Falls back to noop if better-sqlite3
// is unavailable (e.g. pure-JS environment) so the bridge still works.
let _rateLimiter = null;
let _rateLimiterInitialized = false;

function getHistory(agent) {
  if (_rateLimiterInitialized) return _rateLimiter;
  _rateLimiterInitialized = true;
  try {
    // Dynamic import avoids hard crash if better-sqlite3 native addon isn't available
    const Database = (await import("better-sqlite3")).default;
    const dbPath = process.env.DATABASE_PATH ?? join(homedir(), ".config", "sentinel", "sentinel.db");
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS spend_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        token TEXT NOT NULL,
        amount REAL NOT NULL,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_spend ON spend_log (agent, token, timestamp);
    `);
    const insert = db.prepare("INSERT INTO spend_log (agent, token, amount, timestamp) VALUES (?, ?, ?, ?)");
    const sumStmt = db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM spend_log WHERE agent = ? AND token = ? AND timestamp >= ?");
    const countStmt = db.prepare("SELECT COUNT(*) AS n FROM spend_log WHERE agent = ? AND timestamp >= ?");

    function tokenKey(t) {
      if (t === "SOL") return "SOL";
      if (t === "USDC") return "USDC";
      return typeof t === "string" ? t : t.mint;
    }

    _rateLimiter = {
      spentInWindow(token, windowMs, nowMs) {
        return sumStmt.get(agent, tokenKey(token), nowMs - windowMs)?.total ?? 0;
      },
      txCountInWindow(windowMs, nowMs) {
        return countStmt.get(agent, nowMs - windowMs)?.n ?? 0;
      },
      record(tx) {
        insert.run(agent, tokenKey(tx.token), tx.amount, tx.timestamp);
      },
    };
  } catch {
    // better-sqlite3 not available — fall back to noop
    _rateLimiter = null;
  }
  return _rateLimiter;
}

const noopHistory = {
  spentInWindow: () => 0,
  txCountInWindow: () => 0,
};

const POLICY_PATH =
  process.env.SENTINEL_POLICY_PATH ?? join(homedir(), ".config", "sentinel", "policy.yml");

let cachedPolicy = null;
let cachedAt = 0;
const POLICY_TTL_MS = 30_000;

function loadPolicy() {
  const now = Date.now();
  if (cachedPolicy && now - cachedAt < POLICY_TTL_MS) return cachedPolicy;
  const yaml = readFileSync(POLICY_PATH, "utf8");
  cachedPolicy = parsePolicy(parseYaml(yaml));
  cachedAt = now;
  return cachedPolicy;
}

export async function check(ctx) {
  let policy;
  try {
    policy = loadPolicy();
  } catch (err) {
    return { allow: false, reason: `Sentinel: failed to load policy at ${POLICY_PATH}: ${err.message}` };
  }

  let summaries;
  try {
    summaries = adaptCtx(ctx, { agent: policy.agent });
  } catch (err) {
    return { allow: false, reason: `Sentinel: ctx adapter error: ${err.message}` };
  }

  if (summaries === null) {
    // Non-Solana chain — defer to Zerion's own EVM rules.
    return { allow: true };
  }

  // D2: Use real rate limiter if available, noopHistory otherwise
  const history = (await getHistory(policy.agent)) ?? noopHistory;
  const now = Date.now();

  for (const tx of summaries) {
    const verdict = evaluate({ policy, tx, history, now });
    if (verdict.type === "deny") {
      return { allow: false, reason: `Sentinel deny: ${verdict.reason}` };
    }
    if (verdict.type === "escalate") {
      return { allow: false, reason: `Sentinel escalate: ${verdict.reason}` };
    }
  }

  // Record spend for allowed txs so rate limits accumulate
  if (_rateLimiter) {
    for (const tx of summaries) _rateLimiter.record(tx);
  }

  return { allow: true };
}

export default { check };
