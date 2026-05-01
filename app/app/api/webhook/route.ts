import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { classifyTx, type HeliusEnhancedTx } from "@/lib/helius";

export const runtime = "nodejs";

// Cap the webhook body to defend against memory blow-up: 256KB is generous for
// a 100-tx Helius batch.
const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

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

// HARDEN-1: constant-time secret comparison to defeat timing oracles.
// Helius sends the secret verbatim in the Authorization header; we accept
// the legacy raw form AND the recommended `Bearer <secret>` form. Length
// mismatches return false without leaking the expected length.
function authMatchesConstantTime(got: string | null, expected: string): boolean {
  if (!got) return false;
  const presented = got.startsWith("Bearer ") ? got.slice(7) : got;
  if (presented.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  const guard = assertWebhookConfigured();
  if (guard) return guard;
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  if (expected) {
    const got = req.headers.get("authorization");
    if (!authMatchesConstantTime(got, expected)) {
      return NextResponse.json(
        { code: "WEBHOOK_AUTH_FAILED", message: "Bad Authorization header" },
        { status: 401 },
      );
    }
  }

  // HARDEN-2: body size cap. Read as text first so we can size-check before
  // JSON.parse, which has unbounded memory cost on adversarial input.
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "body read failed" }, { status: 400 });
  }
  if (raw.length > MAX_WEBHOOK_BODY_BYTES) {
    return NextResponse.json(
      { error: "body exceeds size cap" },
      { status: 413 },
    );
  }

  let body: HeliusEnhancedTx[] | HeliusEnhancedTx;
  try {
    body = JSON.parse(raw) as HeliusEnhancedTx[] | HeliusEnhancedTx;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const txs = Array.isArray(body) ? body : [body];

  const db = getDb();
  // HARDEN-3: replay dedupe — INSERT OR IGNORE against UNIQUE(signature). A
  // re-delivered (or re-played) Helius payload with the same sig is a no-op,
  // not a duplicated row that skews the spend graph or pollutes live activity.
  const insert = db.prepare(
    `INSERT OR IGNORE INTO policy_events (kind, agent, signature, payload, received_at, decoded)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const now = Date.now();
  let ingested = 0;
  let deduped = 0;
  const insertMany = db.transaction((items: HeliusEnhancedTx[]) => {
    for (const tx of items) {
      const decoded = classifyTx(tx);
      const result = insert.run(
        decoded.kind,
        decoded.agent,
        tx.signature ?? null,
        JSON.stringify(tx),
        now,
        JSON.stringify(decoded),
      );
      if (result.changes > 0) ingested += 1;
      else deduped += 1;
    }
  });
  insertMany(txs);

  return NextResponse.json({ ok: true, ingested, deduped });
}
