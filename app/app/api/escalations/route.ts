import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, type EscalationRow } from "@/lib/db";

export const runtime = "nodejs";

const PostBody = z.object({
  id: z.string().optional(),
  action: z.enum(["approve", "reject", "approve_and_update"]).optional(),
  agent: z.string().optional(),
  reason: z.string().optional(),
  requirements: z.unknown().optional(),
});

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
  const body = PostBody.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const db = getDb();

  if (body.data.id && body.data.action) {
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
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    db.prepare(
      `INSERT INTO escalations (id, agent, reason, requirements, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(
      id,
      body.data.agent,
      body.data.reason,
      JSON.stringify(body.data.requirements ?? {}),
      Date.now(),
    );
    return NextResponse.json({ ok: true, id });
  }

  return NextResponse.json({ error: "missing fields" }, { status: 400 });
}
