import { getDb, type PolicyEventRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("hello", { ts: Date.now() });

      const tick = () => {
        try {
          const events = db
            .prepare(
              `SELECT id, kind, agent, signature, payload, received_at, decoded
               FROM policy_events
               ORDER BY received_at DESC
               LIMIT 5`,
            )
            .all() as PolicyEventRow[];
          const pending = (
            db
              .prepare(`SELECT COUNT(*) AS n FROM escalations WHERE status = 'pending'`)
              .get() as { n: number }
          ).n;
          send("tick", { events, pending });
        } catch (err) {
          send("error", { message: err instanceof Error ? err.message : String(err) });
        }
      };

      tick();
      const interval = setInterval(tick, 1000);
      const timeout = setTimeout(() => {
        clearInterval(interval);
        controller.close();
      }, 10 * 60_000);

      return () => {
        clearInterval(interval);
        clearTimeout(timeout);
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
