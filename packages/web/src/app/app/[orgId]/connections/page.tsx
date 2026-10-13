import { ConnectionsView } from '@/components/connections/connections-view';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';

export default async function ConnectionsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <ConnectionsView orgId={orgId} />
    </QuerySuspense>
  );
}
