import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseT } from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS policy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                  -- registered | updated | revoked
  agent TEXT NOT NULL,
  signature TEXT,
  payload TEXT NOT NULL,               -- raw JSON from Helius
  received_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_received ON policy_events (received_at);
CREATE INDEX IF NOT EXISTS idx_events_agent ON policy_events (agent);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  reason TEXT NOT NULL,
  requirements TEXT NOT NULL,           -- JSON
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations (status, created_at);
`;

let dbHandle: DatabaseT | null = null;

export function getDb(): DatabaseT {
  if (dbHandle) return dbHandle;
  const path = process.env.DATABASE_PATH ?? "./.data/sentinel.db";
  mkdirSync(dirname(path), { recursive: true });
  dbHandle = new Database(path);
  dbHandle.pragma("journal_mode = WAL");
  dbHandle.exec(SCHEMA);
  return dbHandle;
}

export interface PolicyEventRow {
  id: number;
  kind: string;
  agent: string;
  signature: string | null;
  payload: string;
  received_at: number;
}

export interface EscalationRow {
  id: string;
  agent: string;
  reason: string;
  requirements: string;
  status: "pending" | "approved" | "rejected";
  created_at: number;
  resolved_at: number | null;
}
