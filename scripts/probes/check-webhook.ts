// A2 diagnostic: report on webhook ingestion state. Run after fire-register-policy
// to confirm Helius delivered to the dashboard. If 0 rows, the tunnel + webhook
// + dashboard chain has a break.
//
// Run: pnpm tsx scripts/probes/check-webhook.ts

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { loadDotEnv } from "./load-env";

loadDotEnv();

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const dbPath = process.env.DATABASE_PATH
  ? resolve(process.env.DATABASE_PATH)
  : resolve(REPO_ROOT, "app/.data/sentinel.db");

if (!existsSync(dbPath)) {
  console.error(`[check] no SQLite at ${dbPath} — start the dashboard once (pnpm -F @sentinel/app dev) so it gets created.`);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

const total = (db.prepare("SELECT COUNT(*) AS n FROM policy_events").get() as { n: number }).n;
const recent = db
  .prepare("SELECT id, kind, agent, signature, received_at FROM policy_events ORDER BY received_at DESC LIMIT 5")
  .all() as Array<{ id: number; kind: string; agent: string | null; signature: string | null; received_at: number }>;

console.log(`[check] DB     : ${dbPath}`);
console.log(`[check] events : ${total}`);

if (total === 0) {
  console.log("[check] ⚠ no events ingested yet. Common causes:");
  console.log("        1. Dashboard not running while webhook fired (`pnpm -F @sentinel/app dev`)");
  console.log("        2. Tunnel URL stale (re-register webhook with current cloudflared/ngrok URL)");
  console.log("        3. HELIUS_WEBHOOK_SECRET mismatch → 401 silently rejected");
  console.log("        4. Webhook registered for wrong program ID (check Helius dashboard)");
  console.log("        5. No tx fired yet that touches the watched program");
  process.exit(2);
}

console.log("[check] last 5:");
for (const r of recent) {
  console.log(
    `  #${r.id}  ${new Date(r.received_at).toISOString()}  kind=${r.kind}  agent=${
      r.agent ?? "?"
    }  sig=${r.signature?.slice(0, 16) ?? "?"}…`,
  );
}
