'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { repairResultSchema } from '@payscope/shared/repair-schemas';
import { apiFetch } from '@/lib/api-client';

export type RepairPath = 'reprocess-event' | 'correct-entitlement' | 'resolve-finding';
export type RepairRequest = { body: Record<string, string>; idempotencyKey: string };

export function useRepair(orgId: string, path: RepairPath) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, idempotencyKey }: RepairRequest) =>
      repairResultSchema.parse(
        await apiFetch(`/api/v1/orgs/${orgId}/repairs/${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
          body: JSON.stringify(body),
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId] }),
  });
}
