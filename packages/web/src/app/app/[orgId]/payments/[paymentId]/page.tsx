import { notFound } from 'next/navigation';
import { z } from 'zod';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { PaymentDetail } from '@/components/records/payment-detail';

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ orgId: string; paymentId: string }>;
}) {
  const { orgId, paymentId } = await params;
  if (!z.uuid().safeParse(paymentId).success) notFound();
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <PaymentDetail orgId={orgId} paymentId={paymentId} />
    </QuerySuspense>
  );
}
