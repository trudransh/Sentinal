import { getDb, type PolicyEventRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SSE stream of recent policy events + pending escalation count.
// Hard-stops after 10 minutes — clients reconnect transparently via the
// browser EventSource retry semantics.
const HARD_STOP_MS = 10 * 60_000;
const TICK_MS = 1000;

export async function GET(req: Request): Promise<Response> {
  const db = getDb();
  let closed = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();

      // Single guarded enqueue — if the underlying ReadableStream has been
      // detached (client disconnect), `controller.enqueue` throws
      // ERR_INVALID_STATE. Track that so the next tick stops trying.
      const send = (event: string, data: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          stop();
        }
      };

      const stop = (): void => {
        if (closed) return;
        closed = true;
        if (interval) clearInterval(interval);
        if (timeout) clearTimeout(timeout);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // The browser closing the EventSource fires the abort signal — wire
      // it to our cleanup so we don't keep ticking against a dead controller.
      if (req.signal.aborted) {
        stop();
        return;
      }
      req.signal.addEventListener("abort", stop, { once: true });

      send("hello", { ts: Date.now() });

      const tick = (): void => {
        if (closed) return;
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
              .prepare(
                `SELECT COUNT(*) AS n FROM escalations WHERE status = 'pending'`,
              )
              .get() as { n: number }
          ).n;
          send("tick", { events, pending });
        } catch (err) {
          send("error", {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      };

      tick();
      interval = setInterval(tick, TICK_MS);
      timeout = setTimeout(stop, HARD_STOP_MS);
    },
    cancel() {
      // Client called reader.cancel() or otherwise tore down the stream.
      closed = true;
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
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
