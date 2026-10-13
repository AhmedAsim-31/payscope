import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { RunDetail } from '@/components/reconciliation/run-detail';

export default async function RunPage({
  params,
}: {
  params: Promise<{ orgId: string; runId: string }>;
}) {
  const { orgId, runId } = await params;
  if (!z.uuid().safeParse(runId).success) notFound();
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <RunDetail orgId={orgId} runId={runId} />
    </QuerySuspense>
  );
}
