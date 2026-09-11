import { getTranslations } from 'next-intl/server';
import { CopyButton } from '@/components/shared/copy-button';

/** 备份/恢复参考命令(connstring 经环境变量传入,避免明文落配置) */
const BACKUP_COMMAND = 'pg_dump "$SHIPMATE_DATABASE_URL" --format=custom --file=shipmate-backup.dump';
const RESTORE_COMMAND =
  'pg_restore --clean --dbname "$SHIPMATE_DATABASE_URL" shipmate-backup.dump';

/**
 * P8 数据管理页:备份(pg_dump 参考)/ 导出(MCP 工具)说明 + 危险区置灰占位。
 * 本页为静态说明,不执行任何数据操作。
 */
export default async function DataSettingsPage() {
  const t = await getTranslations('settings.data');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('description')}</p>
      </header>

      {/* 备份 */}
      <section className="rounded-xl border border-border bg-surface p-5 transition-colors duration-[120ms] hover:border-accent">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-text-primary">{t('backupTitle')}</h2>
          <CopyButton text={BACKUP_COMMAND} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t('backupDesc')}</p>
        <CodeBlock text={BACKUP_COMMAND} />
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t('restoreDesc')}</p>
        <CodeBlock text={RESTORE_COMMAND} />
      </section>

      {/* 导出 */}
      <section className="rounded-xl border border-border bg-surface p-5 transition-colors duration-[120ms] hover:border-accent">
        <h2 className="text-sm font-medium text-text-primary">{t('exportTitle')}</h2>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t('exportDesc')}</p>
      </section>

      {/* 危险区:置灰占位,操作未开放 */}
      <section className="rounded-xl border border-danger/40 bg-surface p-5">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-danger">{t('dangerTitle')}</h2>
          <span className="inline-flex items-center rounded-full bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] px-2 py-0.5 text-[11px] font-medium text-danger">
            {t('comingSoon')}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t('dangerDesc')}</p>
        <div className="mt-4 space-y-2.5">
          <DangerRow label={t('dangerClearRuns')} comingSoon={t('comingSoon')} />
          <DangerRow label={t('dangerDeleteAll')} comingSoon={t('comingSoon')} />
        </div>
      </section>
    </div>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3">
      <pre className="font-mono text-xs leading-relaxed text-text-primary">{text}</pre>
    </div>
  );
}

/** 危险操作行:置灰按钮占位(disabled,点击无效果) */
function DangerRow({ label, comingSoon }: { label: string; comingSoon: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5">
      <span className="min-w-0 text-xs text-text-muted">{label}</span>
      <button
        type="button"
        disabled
        title={comingSoon}
        className="inline-flex h-7 shrink-0 cursor-not-allowed items-center rounded-md border border-border bg-surface px-2.5 text-xs text-text-muted opacity-60"
      >
        {comingSoon}
      </button>
    </div>
  );
}
