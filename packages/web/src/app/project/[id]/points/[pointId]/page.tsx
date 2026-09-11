import { notFound } from 'next/navigation';
import { getPointPageData } from '@/actions/points';
import { PointDetailView } from '@/components/point-detail/point-detail-view';

/**
 * P4 需求点详情(路由 /project/[id]/points/[pointId],对应原型帧 P4/P4b)。
 * 数据经 getPointPageData 一次取齐;点不存在或点不属于该项目时 notFound。
 */
export default async function PointDetailPage({
  params,
}: {
  params: Promise<{ id: string; pointId: string }>;
}) {
  const { id: projectId, pointId } = await params;
  const data = await getPointPageData(pointId).catch(() => null);
  if (!data || data.requirement.projectId !== projectId) notFound();
  return <PointDetailView data={data} projectId={projectId} />;
}
