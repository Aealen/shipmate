import { DomainError, type ReviseStreamEvent } from '@shipmate/core';
import { after } from 'next/server';
import { getShipmate } from '@/lib/core';
import { revalidateApp } from '@/lib/revalidate';

/**
 * 需求点 AI 修订流式端点(spec §9 规则 9a,P4 详情页)。
 *
 * POST body:{ pointId, annotation }
 * 响应:SSE,事件序同 core ReviseStreamEvent(stage → delta → done);
 * 异常收尾:error(中文 message)/ canceled(客户端取消)。
 * request.signal 桥接 AbortController:客户端断开即中止 LLM;写回事务由 core 保证零残留。
 */
export const dynamic = 'force-dynamic';

interface RevisePointBody {
  pointId: string;
  annotation: string;
}

type SseEvent = ReviseStreamEvent | { type: 'error'; message: string } | { type: 'canceled' };

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export async function POST(request: Request) {
  let body: RevisePointBody;
  try {
    body = (await request.json()) as RevisePointBody;
  } catch {
    return Response.json(
      { ok: false, code: 'VALIDATION_ERROR', message: '请求体不是合法 JSON' },
      { status: 400 },
    );
  }
  const { pointId, annotation } = body;
  if (typeof pointId !== 'string' || !pointId || typeof annotation !== 'string' || !annotation.trim()) {
    return Response.json(
      { ok: false, code: 'VALIDATION_ERROR', message: 'pointId 与修订批注不能为空' },
      { status: 400 },
    );
  }

  let core;
  try {
    core = (await getShipmate()).core;
  } catch (e) {
    return Response.json(
      { ok: false, code: 'INTERNAL', message: e instanceof Error ? e.message : '服务初始化失败' },
      { status: 500 },
    );
  }

  const bridge = new AbortController();
  request.signal.addEventListener('abort', () => bridge.abort(), { once: true });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: SseEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await core.analysis.revisePoint(pointId, annotation.trim(), 'human', {
          onEvent: send,
          signal: bridge.signal,
        });
        after(() => revalidateApp());
      } catch (e) {
        if (bridge.signal.aborted || isAbortError(e)) {
          send({ type: 'canceled' });
        } else if (e instanceof DomainError) {
          send({ type: 'error', message: e.message });
        } else {
          console.error('[point-revise-stream] 未预期错误:', e);
          send({
            type: 'error',
            message: e instanceof Error ? e.message : '服务内部错误,请稍后重试',
          });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* 客户端已断开时 close 可能抛错,忽略 */
        }
      }
    },
    cancel() {
      bridge.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
