import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { CustomersList } from '@/components/records/customers-list';

export default async function CustomersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <CustomersList orgId={orgId} />
    </QuerySuspense>
  );
}
