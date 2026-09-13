import { DomainError, type ReviseStreamEvent } from '@shipmate/core';
import { after } from 'next/server';
import { getShipmate } from '@/lib/core';
import { revalidateApp } from '@/lib/revalidate';

/**
 * AI 修订流式端点(原型 P3f3/P3f4:修订弹窗下部流式日志区)。
 *
 * POST body:{ runId, blockIndex, pointIndex?, annotation, keepEvidences? }
 * 响应:SSE,逐事件 `data: {JSON}\\n\\n`,事件序为 core ReviseStreamEvent
 * (stage → delta → done);异常时追加一帧收尾事件:
 * - DomainError → { type:'error', message }(中文原文,toast 直用)
 * - 客户端断开/用户取消 → { type:'canceled' }
 *
 * request.signal 与 ReadableStream cancel 桥接同一 AbortController 传入 core,
 * 客户端断开即中止 LLM 请求;草稿与审计零残留(core 事务保证)。
 */
export const dynamic = 'force-dynamic';

interface ReviseStreamBody {
  runId: string;
  blockIndex: number;
  pointIndex?: number | null;
  annotation: string;
  keepEvidences?: boolean;
}

/** SSE 收尾事件:core 三类事件之外的 error / canceled */
type SseEvent = ReviseStreamEvent | { type: 'error'; message: string } | { type: 'canceled' };

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === 'AbortError';
}

export async function POST(request: Request) {
  let body: ReviseStreamBody;
  try {
    body = (await request.json()) as ReviseStreamBody;
  } catch {
    return Response.json({ ok: false, code: 'VALIDATION_ERROR', message: '请求体不是合法 JSON' }, { status: 400 });
  }
  const { runId, blockIndex, pointIndex, annotation, keepEvidences } = body;
  if (typeof runId !== 'string' || !runId || typeof annotation !== 'string' || !annotation.trim()) {
    return Response.json(
      { ok: false, code: 'VALIDATION_ERROR', message: 'runId 与修订批注不能为空' },
      { status: 400 },
    );
  }
  const isIndex = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  if (!isIndex(blockIndex) || (pointIndex != null && !isIndex(pointIndex))) {
    return Response.json(
      { ok: false, code: 'VALIDATION_ERROR', message: 'blockIndex/pointIndex 必须是非负整数' },
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

  // 客户端断开(取消修订/关页)→ request.signal 触发 → 桥接中止 core 内 LLM 请求
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
          closed = true; // 客户端已断开,后续事件静默丢弃
        }
      };
      try {
        await core.analysis.reviseDraftStream(
          runId,
          { blockIndex, ...(pointIndex != null ? { pointIndex } : {}) },
          annotation.trim(),
          { keepEvidences },
          'human',
          {
            onEvent: send,
            signal: bridge.signal,
          },
        );
        // 修订已落库:流结束后再刷全站缓存(after 保证响应关闭后执行)
        after(() => revalidateApp());
      } catch (e) {
        if (bridge.signal.aborted || isAbortError(e)) {
          send({ type: 'canceled' });
        } else if (e instanceof DomainError) {
          send({ type: 'error', message: e.message });
        } else {
          console.error('[revise-stream] 未预期错误:', e);
          send({ type: 'error', message: e instanceof Error ? e.message : '服务内部错误,请稍后重试' });
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
      // ReadableStream 被客户端提前取消(部分代理断开不触发 request.signal)
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
