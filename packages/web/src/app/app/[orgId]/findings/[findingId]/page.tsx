import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { FindingDetail } from '@/components/reconciliation/finding-detail';

export default async function FindingPage({
  params,
}: {
  params: Promise<{ orgId: string; findingId: string }>;
}) {
  const { orgId, findingId } = await params;
  if (!z.uuid().safeParse(findingId).success) notFound();
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <FindingDetail orgId={orgId} findingId={findingId} />
    </QuerySuspense>
  );
}
