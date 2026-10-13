import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { RunsView } from '@/components/reconciliation/runs-view';

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <RunsView orgId={orgId} />
    </QuerySuspense>
  );
}
