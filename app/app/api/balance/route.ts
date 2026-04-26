import { NextResponse } from "next/server";
import { fetchBalances } from "@/lib/sim";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "missing address" }, { status: 400 });
  }
  try {
    const data = await fetchBalances(address);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
