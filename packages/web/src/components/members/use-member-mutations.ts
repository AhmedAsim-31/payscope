'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { memberSchema } from '@payscope/shared/org-schemas';
import type { Role } from '@payscope/shared/permissions';
import { apiFetch } from '@/lib/api-client';

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export function useMemberMutations(orgId: string) {
  const queryClient = useQueryClient();
  const base = `/api/v1/orgs/${orgId}/members`;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['orgs'] });

  const add = useMutation({
    mutationFn: async (input: { email: string; role: Role }) =>
      memberSchema.parse(await apiFetch(base, jsonInit('POST', input))),
    onSuccess: refresh,
  });

  const changeRole = useMutation({
    mutationFn: async (input: { userId: string; role: Role }) =>
      memberSchema.parse(
        await apiFetch(`${base}/${input.userId}`, jsonInit('PATCH', { role: input.role })),
      ),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: async (input: { userId: string }) => {
      await apiFetch(`${base}/${input.userId}`, { method: 'DELETE' });
    },
    onSettled: refresh,
  });

  const transferOwnership = useMutation({
    mutationFn: async (input: { userId: string }) =>
      memberSchema.parse(
        await apiFetch(`${base}/${input.userId}/transfer-ownership`, { method: 'POST' }),
      ),
    onSettled: refresh,
  });

  return { add, changeRole, remove, transferOwnership };
}
