import { queryOptions } from '@tanstack/react-query';
import { overviewSchema, type OverviewRange } from '@payscope/shared/overview-schemas';
import { apiFetch } from '@/lib/api-client';

export function overviewQueryOptions(orgId: string, range: OverviewRange) {
  return queryOptions({
    queryKey: ['orgs', orgId, 'overview', range],
    queryFn: async () =>
      overviewSchema.parse(await apiFetch(`/api/v1/orgs/${orgId}/overview?range=${range}`)),
    staleTime: 15_000,
  });
}
