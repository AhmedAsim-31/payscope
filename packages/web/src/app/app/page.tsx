import { OrgRedirect } from '@/components/orgs/org-redirect';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';

export default function AppPage() {
  return (
    <main className="mx-auto max-w-md p-6">
      <QuerySuspense fallback={<PageSkeleton />}>
        <OrgRedirect />
      </QuerySuspense>
    </main>
  );
}
