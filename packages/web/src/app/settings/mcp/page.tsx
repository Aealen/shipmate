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
 * P7 MCP 接入页:stdio JSON 配置块 + Claude Code 快速添加命令 + HTTP 端点展示,
 * 均带复制按钮(「已复制 ✓」1.5s 回落)。静态展示页,不取数。
 */
export default async function McpSettingsPage() {
  const t = await getTranslations('settings.mcp');

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-lg font-semibold text-text-primary">{t('title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('description')}</p>
      </header>

      {/* stdio 传输 */}
      <section className="rounded-xl border border-border bg-surface p-5 transition-colors duration-[120ms] hover:border-accent">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-text-primary">{t('stdioTitle')}</h2>
          <CopyButton text={STDIO_CONFIG} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t('stdioDesc')}</p>
        <CodeBlock text={STDIO_CONFIG} />
      </section>

      {/* Claude Code 快速添加 */}
      <section className="rounded-xl border border-border bg-surface p-5 transition-colors duration-[120ms] hover:border-accent">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-text-primary">{t('cliTitle')}</h2>
          <CopyButton text={CLI_COMMAND} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t('cliDesc')}</p>
        <CodeBlock text={CLI_COMMAND} />
      </section>

      {/* HTTP streamable */}
      <section className="rounded-xl border border-border bg-surface p-5 transition-colors duration-[120ms] hover:border-accent">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-text-primary">{t('httpTitle')}</h2>
          <CopyButton text={HTTP_ENDPOINT} />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-text-secondary">{t('httpDesc')}</p>
        <CodeBlock text={HTTP_ENDPOINT} />
        <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-text-muted">
          {t('actorHint')}
        </p>
      </section>
    </div>
  );
}

/** 配置/命令块:mono 等宽、暗底圆角、横向滚动 */
function CodeBlock({ text }: { text: string }) {
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3">
      <pre className="font-mono text-xs leading-relaxed text-text-primary">{text}</pre>
    </div>
  );
}
