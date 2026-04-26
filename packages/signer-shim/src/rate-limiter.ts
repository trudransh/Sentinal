import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import Database from "better-sqlite3";
import type { Database as DatabaseT } from "better-sqlite3";
import type { SpendHistory, Token, TxSummary } from "@sentinel/policy-dsl";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS spend_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  token TEXT NOT NULL,
  amount REAL NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spend ON spend_log (agent, token, timestamp);
`;

export interface RateLimiter extends SpendHistory {
  record(tx: TxSummary): void;
  prune(olderThanMs: number): void;
  close(): void;
}

function tokenKey(t: Token): string {
  if (t === "SOL") return "SOL";
  if (t === "USDC") return "USDC";
  return t.mint;
}

export interface RateLimiterOptions {
  agent: string;
  dbPath?: string;
  db?: DatabaseT;
}

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const db = opts.db ?? openFileDb(opts.dbPath ?? "./.data/sentinel.db");
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  const insert = db.prepare(
    `INSERT INTO spend_log (agent, token, amount, timestamp) VALUES (?, ?, ?, ?)`,
  );
  const sumStmt = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM spend_log
     WHERE agent = ? AND token = ? AND timestamp >= ?`,
  );
  const countStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM spend_log WHERE agent = ? AND timestamp >= ?`,
  );
  const pruneStmt = db.prepare(`DELETE FROM spend_log WHERE timestamp < ?`);

  return {
    record(tx: TxSummary) {
      insert.run(opts.agent, tokenKey(tx.token), tx.amount, tx.timestamp);
    },
    spentInWindow(token: Token, windowMs: number, nowMs: number) {
      const since = nowMs - windowMs;
      const row = sumStmt.get(opts.agent, tokenKey(token), since) as { total: number };
      return row.total ?? 0;
    },
    txCountInWindow(windowMs: number, nowMs: number) {
      const since = nowMs - windowMs;
      const row = countStmt.get(opts.agent, since) as { n: number };
      return row.n ?? 0;
    },
    prune(olderThanMs: number) {
      pruneStmt.run(olderThanMs);
    },
    close() {
      db.close();
    },
  };
}

function openFileDb(path: string): DatabaseT {
  mkdirSync(dirname(path), { recursive: true });
  return new Database(path);
}

export function createInMemoryRateLimiter(agent: string): RateLimiter {
  const db = new Database(":memory:");
  return createRateLimiter({ agent, db });
}
