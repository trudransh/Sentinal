// B4: seed the dashboard with realistic-looking state so judges land on a
// populated UI instead of empty panels. Inserts:
//   - 3 policy_events rows (registered, updated, revoked) for a stable demo agent
//   - 3 escalations rows (1 pending, 1 approved, 1 rejected)
//
// Writes directly to the dashboard's SQLite DB. Idempotent — wipes prior demo
// rows by tag before inserting.
//
// Run: pnpm tsx scripts/seed-demo.ts

import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

// Resolve relative to the repo root (parent of this script's dir) so the
// script writes to the same SQLite file the dashboard reads regardless of
// where pnpm chooses to chdir.
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const dbPath = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : resolve(REPO_ROOT, "app/.data/sentinel.db");
const tag = "[seed-demo]";

if (!existsSync(dbPath)) {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS policy_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  agent TEXT NOT NULL,
  signature TEXT,
  payload TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  reason TEXT NOT NULL,
  requirements TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
`);

// Stable demo agent so PolicyEditor / BalanceWidget / LiveActivity all line up.
const DEMO_AGENT = process.env.NEXT_PUBLIC_DEMO_AGENT ?? "DemoAgentPubKey1nGqHMC6BtqDLKuqGwGWFc2X";

// Wipe prior demo rows so re-running stays clean.
db.prepare(`DELETE FROM policy_events WHERE payload LIKE '%${tag}%'`).run();
db.prepare(`DELETE FROM escalations WHERE reason LIKE '%${tag}%' OR id LIKE 'demo-%'`).run();

const insertEvent = db.prepare(
  `INSERT INTO policy_events (kind, agent, signature, payload, received_at) VALUES (?, ?, ?, ?, ?)`,
);
const insertEsc = db.prepare(
  `INSERT INTO escalations (id, agent, reason, requirements, status, created_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
);

const now = Date.now();
const minutesAgo = (n: number) => now - n * 60_000;

const events = [
  {
    kind: "registered",
    sig: "5Demo1registerSignaturePLACEHOLDERxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    received_at: minutesAgo(45),
    note: "Initial policy registered",
  },
  {
    kind: "updated",
    sig: "5Demo2updateSignaturePLACEHOLDERxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    received_at: minutesAgo(20),
    note: "Cap raised after escalation approval",
  },
  {
    kind: "registered",
    sig: "5Demo3reRegisterSignaturePLACEHOLDERxxxxxxxxxxxxxxxxxxxxxxxxx",
    received_at: minutesAgo(5),
    note: "Second-agent registration",
  },
];

for (const e of events) {
  insertEvent.run(
    e.kind,
    DEMO_AGENT,
    e.sig,
    JSON.stringify({ tag, kind: e.kind, note: e.note, agent: DEMO_AGENT }),
    e.received_at,
  );
}

const escalations = [
  {
    id: "demo-pending",
    reason: `${tag} 5 USDC payment exceeds escalate_above threshold (1 USDC)`,
    status: "pending" as const,
    created_at: minutesAgo(2),
    resolved_at: null,
  },
  {
    id: "demo-approved",
    reason: `${tag} 50 USDC bridge payout — operator confirmed counterparty`,
    status: "approved" as const,
    created_at: minutesAgo(40),
    resolved_at: minutesAgo(38),
  },
  {
    id: "demo-rejected",
    reason: `${tag} payment to denylisted destination — agent attempted policy bypass`,
    status: "rejected" as const,
    created_at: minutesAgo(60),
    resolved_at: minutesAgo(59),
  },
];

for (const e of escalations) {
  insertEsc.run(
    e.id,
    DEMO_AGENT,
    e.reason,
    JSON.stringify({
      scheme: "exact",
      network: "solana:devnet",
      amount: 5,
      token: "USDC",
      payTo: "DpfxWR9oBJeDL8vf9nHVGUK4BKDcQfGUmo5Tpah9joMN",
      resourceUrl: "https://example/expensive",
    }),
    e.status,
    e.created_at,
    e.resolved_at,
  );
}

const eventCount = (db.prepare("SELECT COUNT(*) AS n FROM policy_events").get() as { n: number }).n;
const escCount = (db.prepare("SELECT COUNT(*) AS n FROM escalations").get() as { n: number }).n;
const pending = (
  db.prepare("SELECT COUNT(*) AS n FROM escalations WHERE status='pending'").get() as { n: number }
).n;

console.log(`[seed-demo] db: ${dbPath}`);
console.log(`[seed-demo] policy_events: ${eventCount} rows`);
console.log(`[seed-demo] escalations:   ${escCount} rows (${pending} pending)`);
console.log(`[seed-demo] demo agent:    ${DEMO_AGENT}`);
console.log(`[seed-demo] open http://localhost:3000 — first pending escalation will trigger the modal.`);

db.close();
