import { PageSkeleton } from '@/components/page-skeleton';
import { OverviewView } from '@/components/overview/overview-view';
import { QuerySuspense } from '@/components/query-suspense';

export default async function OverviewPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton />}>
      <OverviewView orgId={orgId} />
    </QuerySuspense>
  );
}
