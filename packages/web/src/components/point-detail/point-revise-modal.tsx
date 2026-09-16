'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { Modal } from '@/components/shared/modal';
import { showToast } from '@/components/shared/toast';

/**
 * P4 需求点 AI 修订弹窗(spec §9 规则 9a):输入批注 → 流式修订
 * (/api/points/revise-stream SSE:stage 日志 + delta 计数)→ done 即已落库
 * (revision 留痕 + 版本 +1),toast 后刷新服务端数据关弹窗。
 * 修订中可取消(abort,服务端随之中止 LLM,零残留)。
 */

type StreamEvent =
  | { type: 'stage'; message: string }
  | { type: 'delta'; text: string }
  | { type: 'done'; revised: unknown }
  | { type: 'error'; message: string }
  | { type: 'canceled' };

export function PointReviseModal({
  open,
  onClose,
  pointId,
  pointTitle,
}: {
  open: boolean;
  onClose: () => void;
  pointId: string;
  pointTitle: string;
}) {
  const t = useTranslations('pointDetail.revise');
  const router = useRouter();
  const [annotation, setAnnotation] = useState('');
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<{ kind: 'stage'; text: string }[]>([]);
  const [deltaChars, setDeltaChars] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const charsRef = useRef(0);

  /** 统一关闭:修订中先 abort(服务端随之中止 LLM) */
  function requestClose() {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }

  function reset() {
    setRunning(false);
    setLines([]);
    setDeltaChars(0);
    charsRef.current = 0;
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    reset();
    showToast(t('cancelToast'));
  }

  /** 逐帧解析 SSE(同 ReviseModal:空行分帧,data: 前缀取 JSON) */
  async function readSse(res: Response, onEvent: (e: StreamEvent) => void) {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            onEvent(JSON.parse(line.slice(6)) as StreamEvent);
          } catch {
            /* 残缺帧忽略 */
          }
        }
      }
    }
  }

  async function start() {
    if (!annotation.trim() || running) return;
    setRunning(true);
    setLines([]);
    setDeltaChars(0);
    charsRef.current = 0;

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch('/api/points/revise-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pointId, annotation: annotation.trim() }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        let message = `HTTP ${res.status}`;
        try {
          const j = (await res.json()) as { message?: string };
          if (j.message) message = j.message;
        } catch {
          /* 非 JSON 响应 */
        }
        showToast(message, 'error');
        reset();
        return;
      }
      let finished = false;
      await readSse(res, (ev) => {
        if (ev.type === 'stage') {
          setLines((prev) => [...prev, { kind: 'stage', text: ev.message }]);
        } else if (ev.type === 'delta') {
          charsRef.current += ev.text.length;
          setDeltaChars(charsRef.current);
        } else if (ev.type === 'done') {
          finished = true;
        } else if (ev.type === 'error') {
          showToast(ev.message, 'error');
        }
      });
      if (finished) {
        showToast(t('doneToast'));
        setAnnotation('');
        reset();
        onClose();
        router.refresh();
      } else {
        reset();
      }
    } catch (e) {
      if (!ac.signal.aborted) {
        showToast(e instanceof Error ? e.message : String(e), 'error');
        reset();
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  return (
    <Modal open={open} onClose={requestClose} title={t('title')}>
      <p className="truncate text-xs text-text-muted">
        {t('target')}:「{pointTitle}」
      </p>
      <textarea
        value={annotation}
        onChange={(e) => setAnnotation(e.target.value)}
        placeholder={t('placeholder')}
        rows={3}
        disabled={running}
        className="mt-2 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent disabled:opacity-60"
      />
      {lines.length > 0 && (
        <div className="mt-2 flex flex-col gap-1 rounded-lg bg-surface-2 px-3 py-2">
          {lines.map((l, i) => (
            <p key={i} className="text-[11px] text-text-secondary">
              ✦ {l.text}
            </p>
          ))}
          {running && deltaChars > 0 && (
            <p className="text-[11px] text-text-muted">{t('charsDelta', { count: deltaChars })}</p>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        {running ? (
          <button
            type="button"
            onClick={cancel}
            className="h-8 rounded-lg border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            {t('cancel')}
          </button>
        ) : (
          <button
            type="button"
            onClick={requestClose}
            className="h-8 rounded-lg border border-border px-3 text-xs text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
          >
            {t('close')}
          </button>
        )}
        <button
          type="button"
          onClick={start}
          disabled={running || !annotation.trim()}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-xs font-bold text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✨ {running ? t('revising') : t('start')}
        </button>
      </div>
    </Modal>
  );
}
