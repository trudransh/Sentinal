import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { classifyTx, type HeliusEnhancedTx } from "@/lib/helius";

export const runtime = "nodejs";

// D4: refuse to accept payloads when HELIUS_WEBHOOK_SECRET is unset in
// production. The check runs per-request rather than at module load so Next's
// "collect page data" phase during `next build` doesn't trigger the throw.
function assertWebhookConfigured(): Response | null {
  if (process.env.HELIUS_WEBHOOK_SECRET) return null;
  const allowedInDev =
    process.env.NODE_ENV !== "production" &&
    process.env.SENTINEL_ALLOW_UNAUTH_WEBHOOK === "1";
  if (allowedInDev) return null;
  return NextResponse.json(
    {
      code: "WEBHOOK_NOT_CONFIGURED",
      message:
        "HELIUS_WEBHOOK_SECRET is required. Set it, or set SENTINEL_ALLOW_UNAUTH_WEBHOOK=1 in non-production.",
    },
    { status: 503 },
  );
}

export async function POST(req: Request): Promise<Response> {
  const guard = assertWebhookConfigured();
  if (guard) return guard;
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
    `INSERT INTO policy_events (kind, agent, signature, payload, received_at, decoded)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  const insertMany = db.transaction((items: HeliusEnhancedTx[]) => {
    for (const tx of items) {
      const decoded = classifyTx(tx);
      insert.run(
        decoded.kind,
        decoded.agent,
        tx.signature ?? null,
        JSON.stringify(tx),
        now,
        JSON.stringify(decoded),
      );
    }
  });
  insertMany(txs);

  return NextResponse.json({ ok: true, ingested: txs.length });
}
