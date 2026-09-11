import type { AuditReport } from '@shipmate/core';
import { notFound } from 'next/navigation';
import { AuditView } from '@/components/audit/audit-view';
import { getShipmate } from '@/lib/core';

/**
 * P6 项目审计页(路由表数据源:audit.getProjectAuditReport)。
 * 只读取数,直接在服务端调 core;无效项目 id 走 notFound。
 */
export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let report: AuditReport;
  try {
    const { core } = await getShipmate();
    report = await core.audit.getProjectAuditReport(id);
  } catch {
    notFound();
  }

  return <AuditView report={report} />;
}
