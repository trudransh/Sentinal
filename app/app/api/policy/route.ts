import { NextResponse } from "next/server";
import { tryParseYamlPolicy } from "@/lib/policy";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let body: { yaml?: unknown };
  try {
    body = (await req.json()) as { yaml?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.yaml !== "string") {
    return NextResponse.json({ error: "missing 'yaml' string" }, { status: 400 });
  }
  const result = tryParseYamlPolicy(body.yaml);
  if (!result.ok) {
    return NextResponse.json(
      { code: "INVALID_POLICY", error: result.error },
      { status: 422 },
    );
  }
  // The actual update_policy on-chain submission belongs to the operator's wallet,
  // not to the dashboard server. Return the canonical root so the UI can sign.
  return NextResponse.json({ ok: true, rootHex: result.rootHex });
}
