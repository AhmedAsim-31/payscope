import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { CustomerDetail } from '@/components/records/customer-detail';

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ orgId: string; customerId: string }>;
}) {
  const { orgId, customerId } = await params;
  if (!z.uuid().safeParse(customerId).success) notFound();
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <CustomerDetail orgId={orgId} customerId={customerId} />
    </QuerySuspense>
  );
}
