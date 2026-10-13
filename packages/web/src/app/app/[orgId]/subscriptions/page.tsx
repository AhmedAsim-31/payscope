import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { SubscriptionsList } from '@/components/records/subscriptions-list';

export default async function SubscriptionsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <SubscriptionsList orgId={orgId} />
    </QuerySuspense>
  );
}
