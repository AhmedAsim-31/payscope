import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';
import { ScenarioLab } from '@/components/scenarios/scenario-lab';

export default async function ScenariosPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <QuerySuspense fallback={<PageSkeleton rows={6} />}>
      <ScenarioLab orgId={orgId} />
    </QuerySuspense>
  );
}
