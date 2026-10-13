import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { RepairCenter } from '@/components/repairs/repair-center';

export default async function RepairsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <RepairCenter orgId={orgId} />
    </QuerySuspense>
  );
}
