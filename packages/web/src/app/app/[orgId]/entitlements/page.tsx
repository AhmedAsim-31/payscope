import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { EntitlementsList } from '@/components/records/entitlements-list';

export default async function EntitlementsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <EntitlementsList orgId={orgId} />
    </QuerySuspense>
  );
}
