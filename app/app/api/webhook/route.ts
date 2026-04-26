import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { classifyTx, type HeliusEnhancedTx } from "@/lib/helius";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  if (expected) {
    const got = req.headers.get("authorization");
    if (got !== expected) {
      return NextResponse.json(
        { code: "WEBHOOK_AUTH_FAILED", message: "Bad Authorization header" },
        { status: 401 },
      );
    }
  }

  let body: HeliusEnhancedTx[] | HeliusEnhancedTx;
  try {
    body = (await req.json()) as HeliusEnhancedTx[] | HeliusEnhancedTx;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const txs = Array.isArray(body) ? body : [body];

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO policy_events (kind, agent, signature, payload, received_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const insertMany = db.transaction((items: HeliusEnhancedTx[]) => {
    for (const tx of items) {
      const { kind, agent } = classifyTx(tx);
      insert.run(kind, agent, tx.signature ?? null, JSON.stringify(tx), now);
    }
  });
  insertMany(txs);

  return NextResponse.json({ ok: true, ingested: txs.length });
}
