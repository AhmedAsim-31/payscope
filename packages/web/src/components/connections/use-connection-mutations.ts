'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api-client';
import { connectionSchema, type ConnectionProvider } from '@/lib/connection-queries';

export type CreateConnectionInput = {
  provider: ConnectionProvider;
  mode: 'sandbox' | 'simulation';
  displayName: string;
  externalAccountId: string;
  webhookSecrets?: string[];
  apiKey?: string;
};

export type UpdateCredentialsInput = { webhookSecret?: string; apiKey?: string };

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function useConnectionMutations(orgId: string) {
  const queryClient = useQueryClient();
  const base = `/api/v1/orgs/${orgId}/connections`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId, 'connections'] });

  const create = useMutation({
    mutationFn: async (input: CreateConnectionInput) =>
      connectionSchema.parse(await apiFetch(base, jsonInit('POST', input))),
    onSuccess: refresh,
  });

  const update = useMutation({
    mutationFn: async ({ id, ...input }: UpdateCredentialsInput & { id: string }) =>
      connectionSchema.parse(await apiFetch(`${base}/${id}`, jsonInit('PATCH', input))),
    onSuccess: refresh,
  });

  const verify = useMutation({
    mutationFn: async (id: string) =>
      connectionSchema.parse(await apiFetch(`${base}/${id}/verify`, { method: 'POST' })),
    onSettled: refresh,
  });

  return { create, update, verify };
}
