import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getDb, type EscalationRow } from "@/lib/db";

export const runtime = "nodejs";

// HARDEN-4: requirements payload size cap. An unauth (or compromised) caller
// could otherwise pump megabytes into SQLite and crash the dashboard's JSON
// parse on read. 4KB is enough for any realistic x402 PaymentRequirements.
const MAX_REQUIREMENTS_BYTES = 4 * 1024;

const PaymentRequirementsSchema = z
  .object({
    scheme: z.string().max(64).optional(),
    network: z.string().max(64).optional(),
    amount: z.number().finite().nonnegative().optional(),
    token: z.string().max(64).optional(),
    payTo: z.string().max(64).optional(),
    resourceUrl: z.string().max(512).optional(),
  })
  .passthrough();

const PostBody = z.object({
  id: z.string().min(1).max(128).optional(),
  action: z.enum(["approve", "reject", "approve_and_update"]).optional(),
  agent: z.string().min(1).max(64).optional(),
  reason: z.string().min(1).max(512).optional(),
  requirements: PaymentRequirementsSchema.optional(),
});

// HARDEN-5: escalations POST is a privileged operator action — both the
// approve/reject flow and the create-escalation flow let a remote caller
// influence what the dashboard's auto-modal shows. Require a constant-time
// bearer-token check. SENTINEL_DASHBOARD_TOKEN is the operator's secret;
// the modal-mounted EscalationApprover sends it.
function authenticated(req: Request): boolean {
  const expected = process.env.SENTINEL_DASHBOARD_TOKEN;
  if (!expected) {
    // Dev fallback only — explicit opt-in, never silent.
    if (
      process.env.NODE_ENV !== "production" &&
      process.env.SENTINEL_ALLOW_UNAUTH_DASHBOARD === "1"
    ) {
      return true;
    }
    return false;
  }
  const got = req.headers.get("x-sentinel-token");
  if (!got || got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function GET(): Promise<Response> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, agent, reason, requirements, status, created_at, resolved_at
       FROM escalations
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT 100`,
    )
    .all() as EscalationRow[];
  return NextResponse.json({ escalations: rows });
}

export async function POST(req: Request): Promise<Response> {
  if (!authenticated(req)) {
    return NextResponse.json(
      { code: "DASHBOARD_AUTH_REQUIRED", message: "missing or bad x-sentinel-token" },
      { status: 401 },
    );
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "body read failed" }, { status: 400 });
  }
  if (raw.length > MAX_REQUIREMENTS_BYTES * 4) {
    return NextResponse.json({ error: "body exceeds size cap" }, { status: 413 });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const body = PostBody.safeParse(parsed);
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const db = getDb();

  if (body.data.id && body.data.action) {
    // HARDEN-6: the row must exist before we flip its status — silent OK
    // on a missing id was an information-disclosure helper for an attacker
    // probing valid escalation IDs.
    const existing = db
      .prepare(`SELECT id, status FROM escalations WHERE id = ?`)
      .get(body.data.id) as { id: string; status: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (existing.status !== "pending") {
      return NextResponse.json(
        { error: "already resolved", status: existing.status },
        { status: 409 },
      );
    }
    const status =
      body.data.action === "approve" || body.data.action === "approve_and_update"
        ? "approved"
        : "rejected";
    db.prepare(
      `UPDATE escalations SET status = ?, resolved_at = ? WHERE id = ?`,
    ).run(status, Date.now(), body.data.id);
    return NextResponse.json({ ok: true, status });
  }

  if (body.data.agent && body.data.reason) {
    const requirementsJson = JSON.stringify(body.data.requirements ?? {});
    if (requirementsJson.length > MAX_REQUIREMENTS_BYTES) {
      return NextResponse.json(
        { error: "requirements exceeds size cap" },
        { status: 413 },
      );
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO escalations (id, agent, reason, requirements, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(id, body.data.agent, body.data.reason, requirementsJson, Date.now());
    return NextResponse.json({ ok: true, id });
  }

  return NextResponse.json({ error: "missing fields" }, { status: 400 });
}
