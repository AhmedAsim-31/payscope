import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import type { z } from 'zod';
import { ApiClientError, apiFetch } from '@/lib/api-client';

export type RecordResource = 'payments' | 'subscriptions' | 'customers' | 'entitlements' | 'events';

export type RecordPage<T> = { items: T[]; nextCursor: string | null };

export function recordsListOptions<T>(
  orgId: string,
  resource: RecordResource,
  schema: z.ZodType<RecordPage<T>>,
  params: Readonly<Record<string, string>>,
) {
  return infiniteQueryOptions({
    queryKey: ['orgs', orgId, resource, params],
    queryFn: async ({ pageParam }) => {
      const query = new URLSearchParams(params);
      if (pageParam) query.set('cursor', pageParam);
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return schema.parse(await apiFetch(`/api/v1/orgs/${orgId}/${resource}${suffix}`));
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Resolves to null on 404 so the view can render the not-found page. */
export function recordDetailOptions<T>(
  orgId: string,
  resource: RecordResource,
  id: string,
  schema: z.ZodType<T>,
) {
  return queryOptions({
    queryKey: ['orgs', orgId, resource, 'detail', id],
    queryFn: async () => {
      try {
        return schema.parse(
          await apiFetch(`/api/v1/orgs/${orgId}/${resource}/${encodeURIComponent(id)}`),
        );
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 404) return null;
        throw error;
      }
    },
  });
}
