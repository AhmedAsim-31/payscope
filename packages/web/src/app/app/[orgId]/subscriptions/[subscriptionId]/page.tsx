import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { SubscriptionDetail } from '@/components/records/subscription-detail';

export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ orgId: string; subscriptionId: string }>;
}) {
  const { orgId, subscriptionId } = await params;
  if (!z.uuid().safeParse(subscriptionId).success) notFound();
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <SubscriptionDetail orgId={orgId} subscriptionId={subscriptionId} />
    </QuerySuspense>
  );
}
