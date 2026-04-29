import { getScan, getScanReady } from "@/lib/server/scan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  // Block the response until the in-process cache is warm-restored from
  // Redis (or proven empty). This eliminates the "all stations flash NO
  // DATA on reload" race where the first SSE frame shipped rows:[]
  // before warm-restore finished.
  await getScanReady();

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const scan = getScan();
        // Project to the slim shape the client actually consumes for
        // the globe — full METAR text only travels via the per-station
        // drill endpoint. ~80% size reduction over the wire.
        const slim = (scan?.rows ?? []).map((r) => ({
          station: r.station,
          status: r.status,
          minutes_since_last_report: r.minutes_since_last_report ?? null,
        }));
        controller.enqueue(
          encoder.encode(`event: scan\n` + `data: ${JSON.stringify({
            scanned_at: scan?.scanned_at ?? null,
            duration_ms: scan?.duration_ms ?? null,
            total: slim.length,
            rows: slim,
            warming: !scan,
          })}\n\n`),
        );
      };
      send();
      timer = setInterval(send, 30_000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
