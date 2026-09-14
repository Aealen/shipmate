import { getTranslations } from 'next-intl/server';
import { CopyButton } from '@/components/shared/copy-button';

/** 与 packages/mcp/README.md 的 Claude Code 接入示例保持一致 */
const STDIO_CONFIG = JSON.stringify(
  {
    mcpServers: {
      shipmate: {
        command: 'node',
        args: ['--import', 'tsx', 'packages/mcp/src/cli.ts'],
        env: { SHIPMATE_DATABASE_URL: 'postgresql://user:pass@host:port/db' },
      },
    },
  },
  null,
  2,
);

/** Claude Code 快速添加命令(仓库根目录执行) */
const CLI_COMMAND = 'claude mcp add shipmate -- node --import tsx packages/mcp/src/cli.ts';

/** HTTP streamable 端点(spec §10:web 服务固定 47610 端口) */
const HTTP_ENDPOINT = 'http://localhost:47610/api/mcp';

/**
 * P7 MCP 接入页(对齐原型帧):页头大标题 + HTTP / stdio 双卡并排
 * (HTTP 带推荐徽章与端点框;stdio 深底 JSON 块),均带复制按钮
 * (「已复制 ✓」1.5s 回落)。CLI 快捷命令为计划补充项,置于双卡下方。
 * 静态展示页,不取数。
 */
export default async function McpSettingsPage() {
  const t = await getTranslations('settings.mcp');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-[22px] font-bold leading-tight text-text-primary">{t('title')}</h1>
        <p className="text-[13px] leading-snug text-text-secondary">{t('description')}</p>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        {/* HTTP streamable */}
        <section className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-[18px]">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-text-primary">{t('httpTitle')}</h2>
            <span className="inline-flex shrink-0 items-center rounded-[4px] bg-accent-dim px-[7px] py-[2px] text-[10px] font-bold leading-none text-accent">
              {t('httpRecommended')}
            </span>
            <span className="min-w-0 flex-1" />
            <CopyButton text={HTTP_ENDPOINT} />
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{t('httpDesc')}</p>
          <div className="flex items-center gap-2.5 rounded-[8px] bg-bg px-3.5 py-[11px]">
            <code className="min-w-0 flex-1 truncate font-mono text-[13px] text-text-primary">
              {HTTP_ENDPOINT}
            </code>
          </div>
          <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-text-muted">
            {t('actorHint')}
          </p>
        </section>

        {/* stdio 传输 */}
        <section className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-[18px]">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-text-primary">{t('stdioTitle')}</h2>
            <span className="min-w-0 flex-1" />
            <CopyButton text={STDIO_CONFIG} />
          </div>
          <p className="text-xs leading-relaxed text-text-secondary">{t('stdioDesc')}</p>
          <pre className="overflow-x-auto rounded-[8px] bg-[#1E222B] p-3.5 font-mono text-xs leading-relaxed text-[#9CDCFE]">
            {STDIO_CONFIG}
          </pre>
        </section>
      </div>

      {/* Claude Code 快捷命令(计划补充项) */}
      <section className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-[18px]">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-text-primary">{t('cliTitle')}</h2>
          <span className="min-w-0 flex-1" />
          <CopyButton text={CLI_COMMAND} />
        </div>
        <p className="text-xs leading-relaxed text-text-secondary">{t('cliDesc')}</p>
        <div className="flex items-center gap-2.5 rounded-[8px] bg-bg px-3.5 py-[11px]">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-text-primary">
            {CLI_COMMAND}
          </code>
        </div>
      </section>
    </div>
  );
}
