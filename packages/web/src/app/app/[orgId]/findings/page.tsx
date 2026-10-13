import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { FindingsList } from '@/components/reconciliation/findings-list';

export default async function FindingsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <FindingsList orgId={orgId} />
    </QuerySuspense>
  );
}
