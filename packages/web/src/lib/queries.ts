import { queryOptions } from '@tanstack/react-query';
import { memberListSchema, orgListSchema } from '@payscope/shared/org-schemas';
import { apiFetch } from '@/lib/api-client';

export const orgsQueryOptions = queryOptions({
  queryKey: ['orgs'],
  queryFn: async () => orgListSchema.parse(await apiFetch('/api/v1/orgs')).orgs,
});

export const membersQueryOptions = (orgId: string) =>
  queryOptions({
    queryKey: ['orgs', orgId, 'members'],
    queryFn: async () =>
      memberListSchema.parse(await apiFetch(`/api/v1/orgs/${orgId}/members`)).members,
  });
