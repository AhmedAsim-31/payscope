import { IncidentsList } from '@/components/incidents/incidents-list';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';

export default async function IncidentsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <IncidentsList orgId={orgId} />
    </QuerySuspense>
  );
}
