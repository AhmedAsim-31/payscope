import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { EntitlementDetail } from '@/components/records/entitlement-detail';

export default async function EntitlementPage({
  params,
}: {
  params: Promise<{ orgId: string; entitlementId: string }>;
}) {
  const { orgId, entitlementId } = await params;
  if (!z.uuid().safeParse(entitlementId).success) notFound();
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <EntitlementDetail orgId={orgId} entitlementId={entitlementId} />
    </QuerySuspense>
  );
}
