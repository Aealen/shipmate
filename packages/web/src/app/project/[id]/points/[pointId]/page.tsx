import { notFound } from 'next/navigation';
import { listModulesAction } from '@/actions/modules';
import { getPointPageData } from '@/actions/points';
import { PointDetailView } from '@/components/point-detail/point-detail-view';

/**
 * P4 需求点详情(路由 /project/[id]/points/[pointId],对应原型帧 P4/P4b)。
 * 数据经 getPointPageData 一次取齐;点不存在或点不属于该项目时 notFound。
 * 另按需求.moduleId 补模块名(spec §14:面包屑为 项目 / 模块 / 需求 / 需求点,
 * 模块段只读,需求未挂模块时不渲染该段)。
 */
export default async function PointDetailPage({
  params,
}: {
  params: Promise<{ id: string; pointId: string }>;
}) {
  const { id: projectId, pointId } = await params;
  const [data, modules] = await Promise.all([
    getPointPageData(pointId).catch(() => null),
    listModulesAction(projectId).catch(() => []),
  ]);
  if (!data || data.requirement.projectId !== projectId) notFound();
  const moduleName = modules.find((m) => m.id === data.requirement.moduleId)?.name ?? null;
  return <PointDetailView data={data} projectId={projectId} moduleName={moduleName} />;
}
