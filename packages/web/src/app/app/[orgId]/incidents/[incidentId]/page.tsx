import { notFound } from 'next/navigation';
import { z } from 'zod';
import { IncidentDetail } from '@/components/incidents/incident-detail';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ orgId: string; incidentId: string }>;
}) {
  const { orgId, incidentId } = await params;
  if (!z.uuid().safeParse(incidentId).success) notFound();
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <IncidentDetail orgId={orgId} incidentId={incidentId} />
    </QuerySuspense>
  );
}
