'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type SVGProps } from 'react';
import { createProjectAction } from '@/actions/projects';
import { EmptyState } from '@/components/shared/empty-state';
import { Modal } from '@/components/shared/modal';
import { showToast } from '@/components/shared/toast';

export interface GroupOption {
  id: string;
  name: string;
}

/**
 * 创建项目弹窗(P1):名称必填 / 描述可选 / 分组可选。
 * 触发器二态:常规主按钮(页面有项目)或 EmptyState 空状态引导(无项目)——
 * onAction 是函数 prop,须由本客户端组件持有,故触发器并入此处。
 */
export function CreateProjectDialog({
  groups,
  empty,
}: {
  groups: GroupOption[];
  /** 传入则以空状态引导为触发器(全局无项目时) */
  empty?: { title: string; description: string };
}) {
  const t = useTranslations('home');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [groupId, setGroupId] = useState('');
  const [pending, startTransition] = useTransition();

  const close = () => setOpen(false);
  const reset = () => {
    setName('');
    setDescription('');
    setGroupId('');
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createProjectAction({
        name: trimmed,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(groupId ? { groupId } : {}),
      });
      if (res.ok) {
        showToast(t('created', { name: res.data.name }));
        reset();
        close();
        router.refresh();
      } else {
        showToast(res.message, 'error');
      }
    });
  };

  const inputCls =
    'w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent';

  return (
    <>
      {empty ? (
        <EmptyState
          title={empty.title}
          description={empty.description}
          actionLabel={t('createProject')}
          onAction={() => setOpen(true)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-accent px-4 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97]"
        >
          <IconPlus className="h-4 w-4" />
          {t('createProject')}
        </button>
      )}

      <Modal open={open} onClose={close} title={t('createTitle')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <label className="block space-y-1.5">
            <span className="text-sm text-text-secondary">{t('fieldName')}</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('fieldNamePlaceholder')}
              autoFocus
              maxLength={100}
              className={`${inputCls} h-9`}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm text-text-secondary">{t('fieldDesc')}</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('fieldDescPlaceholder')}
              maxLength={500}
              className={`${inputCls} min-h-20 py-2`}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm text-text-secondary">{t('fieldGroup')}</span>
            <select
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              className={`${inputCls} h-9`}
            >
              <option value="">{t('groupNone')}</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={close}
              className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
            >
              {t('cancel')}
            </button>
            <button
              type="submit"
              disabled={pending || !name.trim()}
              className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-sm font-medium text-white transition-transform duration-[80ms] hover:opacity-90 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? t('submitting') : t('submit')}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden
      {...props}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
