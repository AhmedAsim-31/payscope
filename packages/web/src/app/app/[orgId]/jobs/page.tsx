import { JobsSummary } from '@/components/events/jobs-summary';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';

export default async function JobsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={3} />}>
      <JobsSummary orgId={orgId} />
    </QuerySuspense>
  );
}
