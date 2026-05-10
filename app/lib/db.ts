import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseT } from "better-sqlite3";

// Tables only — indexes are applied separately so we can dedupe first.
const TABLES_SCHEMA = `
CREATE TABLE IF NOT EXISTS policy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  agent TEXT NOT NULL,
  signature TEXT,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  decoded TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_received ON policy_events (received_at);
CREATE INDEX IF NOT EXISTS idx_events_agent ON policy_events (agent);

CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  reason TEXT NOT NULL,
  requirements TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_escalations_status ON escalations (status, created_at);
`;

// HARDEN-3: replay dedupe. NULL signatures are treated as distinct.
const UNIQUE_SIGNATURE_INDEX = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_signature
ON policy_events (signature)
WHERE signature IS NOT NULL;
`;

// SQLite has no `ALTER TABLE … ADD COLUMN IF NOT EXISTS`. Migrate by introspection.
function migrateDecodedColumn(db: DatabaseT): void {
  const cols = db
    .prepare(`PRAGMA table_info(policy_events)`)
    .all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "decoded")) {
    db.exec(`ALTER TABLE policy_events ADD COLUMN decoded TEXT`);
  }
}

// If a previous run inserted duplicate signatures (e.g. seed-demo before the
// UNIQUE index existed, or manual inserts), the migration to add the unique
// index will fail. Keep the most recent row per signature; drop the rest.
function dedupeSignatures(db: DatabaseT): void {
  db.exec(`
    DELETE FROM policy_events
    WHERE signature IS NOT NULL
      AND id NOT IN (
        SELECT MAX(id) FROM policy_events
        WHERE signature IS NOT NULL
        GROUP BY signature
      );
  `);
}

let dbHandle: DatabaseT | null = null;

export function getDb(): DatabaseT {
  if (dbHandle) return dbHandle;
  const path = process.env.DATABASE_PATH ?? "./.data/sentinel.db";
  mkdirSync(dirname(path), { recursive: true });
  dbHandle = new Database(path);
  dbHandle.pragma("journal_mode = WAL");

  // 1. Tables and non-unique indexes (idempotent).
  dbHandle.exec(TABLES_SCHEMA);

  // 2. ALTER TABLE for the decoded column on older databases.
  migrateDecodedColumn(dbHandle);

  // 3. Drop duplicate signatures, then add the unique index.
  // Doing this in one db.exec call so it succeeds on first cold start with
  // dirty data inherited from earlier seed runs.
  try {
    dbHandle.exec(UNIQUE_SIGNATURE_INDEX);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("UNIQUE constraint failed")
    ) {
      dedupeSignatures(dbHandle);
      dbHandle.exec(UNIQUE_SIGNATURE_INDEX);
    } else {
      throw err;
    }
  }

  return dbHandle;
}

export interface PolicyEventRow {
  id: number;
  kind: string;
  agent: string;
  signature: string | null;
  payload: string;
  received_at: number;
  decoded: string | null;
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
