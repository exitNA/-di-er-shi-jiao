import { getCurrentUser } from "@/features/auth/server/current-user";
import { getContainer } from "@/server/container";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

const encoder = new TextEncoder();

export async function GET(request: Request, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });

  const { jobId } = await context.params;
  const repository = getContainer().analysisRepository;
  if (!await repository.getOwnedSnapshot(user.id, jobId)) {
    return Response.json({ error: "分析不存在" }, { status: 404 });
  }

  const after = readCursor(request);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let cursor = after;
      const deadline = Date.now() + 25_000;
      try {
        while (!request.signal.aborted && Date.now() < deadline) {
          const events = await repository.listEvents(user.id, jobId, cursor, 100);
          for (const event of events) {
            controller.enqueue(
              encoder.encode(
                `id: ${event.id}\nevent: changed\ndata: ${JSON.stringify({ eventType: event.eventType })}\n\n`,
              ),
            );
            cursor = event.id;
          }
          await new Promise((resolve) => setTimeout(resolve, events.length ? 100 : 1000));
        }
        controller.close();
      } catch (error) {
        if (request.signal.aborted) controller.close();
        else controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function readCursor(request: Request): number {
  const raw = request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  const cursor = Number(raw ?? 0);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
}
