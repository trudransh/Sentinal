import { NextResponse } from "next/server";
import { fetchSpend } from "@/lib/spend";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = url.searchParams.get("address");
  const windowDays = Math.max(1, Math.min(30, Number(url.searchParams.get("days") ?? "7")));
  if (!address) {
    return NextResponse.json({ error: "missing address" }, { status: 400 });
  }
  const data = await fetchSpend(address, windowDays);
  return NextResponse.json(data);
}
