import type { ChangeLogRow, ModuleSummary } from '@shipmate/core';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listModulesAction } from '@/actions/modules';
import { getProject } from '@/actions/projects';
import { ModulesPanel } from '@/components/project/modules-panel';
import { StatCard } from '@/components/shared/stat-card';

/**
 * P2 项目概览(Notion 化,对齐原型加强帧 P2x):五张统计卡一行(需求/需求点/
 * 已确认/开发中/已超期)+「模块进度」区块(3 列模块卡,项目级模块管理)+
 * 整宽「最近动态」卡(圆角 14 无边框)——行式条目(类型圆点 + 类型徽章 + 详情 +
 * actor + 时间四要素同行)。时间线:linkage_impact 徽章微光警示;条目 stagger
 * 40ms 滑入 180ms(spec §14)。
 */
export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('project');

  const [summary, modules] = await Promise.all([
    getProject(id).catch(() => null),
    listModulesAction(id).catch<ModuleSummary[]>(() => []),
  ]);
  if (!summary) notFound();

  const {
    requirementTotal,
    requirementDone,
    overdueRequirementCount,
    pointStatusCounts,
    recentChanges,
  } = summary;
  const pointTotal = Object.values(pointStatusCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="flex w-full flex-col gap-6 p-8">
      {/* spec §14 时间线动画 keyframes(仅本页使用,随页面注入) */}
      <style href="project-overview-anim" precedence="default">{`
        @keyframes timeline-enter {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes impact-glow {
          0%, 100% { box-shadow: 0 0 0 0 transparent; }
          50% { box-shadow: 0 0 8px 1px color-mix(in srgb, var(--danger) 45%, transparent); }
        }
      `}</style>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard label={t('statRequirements')} value={requirementTotal} />
        <StatCard label={t('statPoints')} value={pointTotal} />
        <StatCard
          label={t('statConfirmed')}
          value={`${pointStatusCounts.confirmed}/${pointTotal}`}
          valueClassName="text-accent"
        />
        <StatCard
          label={t('statDeveloping')}
          value={pointStatusCounts.developing}
          valueClassName="text-warning"
        />
        <StatCard
          label={t('statOverdue')}
          value={overdueRequirementCount}
          valueClassName="text-danger"
        />
      </div>

      {/* 模块进度(项目级模块管理):统计卡与最近动态之间,CRUD 后自刷新 */}
      <ModulesPanel projectId={id} modules={modules} />

      <section className="flex w-full flex-col gap-2.5 rounded-[14px] bg-surface p-6">
        <div className="flex w-full items-center gap-2">
          <h2 className="text-[15px] font-bold tracking-tight text-text-primary">
            {t('recentChanges')}
          </h2>
          <span className="min-w-0 flex-1" />
          {recentChanges.length > 0 && (
            <Link
              href={`/project/${id}/audit`}
              className="shrink-0 text-[11px] text-accent transition-opacity duration-[120ms] hover:opacity-80"
            >
              {t('auditLink')}
            </Link>
          )}
        </div>
        {recentChanges.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">{t('timelineEmpty')}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {recentChanges.map((row, i) => (
              <TimelineItem
                key={row.id}
                row={row}
                time={formatTime(row.createdAt)}
                entityLabel={t(`entityType.${row.entityType}`)}
                delayMs={Math.min(i, 8) * 40}
              />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

/** changeType → 圆点/徽章彩字(原型 P2:update 蓝 / create 紫 / status_change 灰) */
const CHANGE_TYPE_COLORS: Record<ChangeLogRow['changeType'], string> = {
  create: 'text-ai',
  update: 'text-accent',
  status_change: 'text-draft-gray',
  linkage_impact: 'text-danger',
  discard: 'text-draft-gray',
  delete: 'text-danger',
  revision: 'text-ai',
};

/** actor → 文字色(原型:human 绿 / ai 紫 / mcp 蓝) */
function actorColor(actor: string): string {
  if (actor === 'human') return 'text-success';
  if (actor.startsWith('mcp:')) return 'text-accent';
  return 'text-ai';
}

/** 快照中可读的实体名(after 优先,before 兜底;delete 时 after 为 {deleted:true}) */
function snapshotName(snapshot: unknown): string | null {
  if (snapshot && typeof snapshot === 'object') {
    const o = snapshot as Record<string, unknown>;
    if (typeof o.name === 'string' && o.name) return o.name;
    if (typeof o.title === 'string' && o.title) return o.title;
  }
  return null;
}

/** 时间显示:今天 HH:mm,其余 MM/dd HH:mm(原型风格) */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hm;
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${hm}`;
}

/** 行式条目:类型圆点 + 类型徽章(原词)+ 详情 + actor + 时间,同行排布 */
function TimelineItem({
  row,
  time,
  entityLabel,
  delayMs,
}: {
  row: ChangeLogRow;
  time: string;
  entityLabel: string;
  delayMs: number;
}) {
  const entityName =
    snapshotName(row.afterSnapshot) ?? snapshotName(row.beforeSnapshot) ?? row.entityId.slice(0, 8);
  const detail = `${entityLabel}「${entityName}」`;

  return (
    <li
      className="flex items-center gap-2.5 rounded-[7px] bg-bg px-3 py-[11px]"
      style={{ animation: 'timeline-enter 180ms ease-out both', animationDelay: `${delayMs}ms` }}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full bg-current ${CHANGE_TYPE_COLORS[row.changeType]}`}
      />
      <span
        className={`inline-flex shrink-0 items-center rounded-[4px] bg-surface-2 px-[5px] py-[2px] text-[9px] font-medium leading-none ${CHANGE_TYPE_COLORS[row.changeType]} ${
          row.changeType === 'linkage_impact'
            ? 'animate-[impact-glow_2.4s_ease-in-out_infinite]'
            : ''
        }`}
      >
        {row.changeType}
      </span>
      <span className="min-w-0 truncate text-xs text-text-primary">
        {detail}
        {row.reason ? ` · ${row.reason}` : ''}
      </span>
      <span className="min-w-0 flex-1" />
      <span className={`shrink-0 text-[10px] leading-none ${actorColor(row.actor)}`}>
        {row.actor}
      </span>
      <span className="shrink-0 text-[10px] leading-none tabular-nums text-text-muted">{time}</span>
    </li>
  );
}
