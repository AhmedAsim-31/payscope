import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { PaymentsList } from '@/components/records/payments-list';

export default async function PaymentsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <PaymentsList orgId={orgId} />
    </QuerySuspense>
  );
}
