import { getScan } from "@/lib/server/scan-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        const scan = getScan();
        controller.enqueue(
          encoder.encode(`event: scan\n` + `data: ${JSON.stringify({
            scanned_at: scan?.scanned_at ?? null,
            duration_ms: scan?.duration_ms ?? null,
            total: scan?.total ?? 0,
            rows: scan?.rows ?? [],
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
