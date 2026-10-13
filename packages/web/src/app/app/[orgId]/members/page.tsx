import { PageSkeleton } from '@/components/page-skeleton';
import { MembersView } from '@/components/members/members-view';
import { QuerySuspense } from '@/components/query-suspense';

export default async function MembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={5} />}>
      <MembersView orgId={orgId} />
    </QuerySuspense>
  );
}
