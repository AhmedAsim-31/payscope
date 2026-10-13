'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { runDetailSchema } from '@payscope/shared/reconciliation-schemas';
import { can, type Role } from '@payscope/shared/permissions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/api-client';
import { connectionsQueryOptions } from '@/lib/connection-queries';
import { describeError } from '@/lib/api-messages';

const selectClass =
  'border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

export function StartRunForm({ orgId, role }: { orgId: string; role: Role }) {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(connectionsQueryOptions(orgId));
  const [connectionId, setConnectionId] = useState('');
  const [mode, setMode] = useState<'local' | 'provider'>('local');
  const selected = data.find((c) => c.id === connectionId);
  const providerAllowed = selected?.hasApiKey === true;
  const effectiveMode = providerAllowed ? mode : 'local';

  const start = useMutation({
    mutationFn: async () =>
      runDetailSchema.parse(
        await apiFetch(`/api/v1/orgs/${orgId}/reconciliation/runs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            mode: effectiveMode,
            ...(connectionId ? { connectionId } : {}),
          }),
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId] }),
  });

  if (!can(role, 'reconciliation:run')) return null;

  return (
    <form
      className="flex min-w-0 flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        start.mutate();
      }}
    >
      <div className="grid w-full min-w-0 gap-1.5 sm:w-auto">
        <Label htmlFor="run-connection">Connection</Label>
        <select
          id="run-connection"
          className={selectClass}
          value={connectionId}
          onChange={(event) => setConnectionId(event.target.value)}
        >
          <option value="">All connections</option>
          {data.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.displayName}
            </option>
          ))}
        </select>
      </div>
      <div className="grid w-full min-w-0 gap-1.5 sm:w-auto">
        <Label htmlFor="run-mode">Mode</Label>
        <select
          id="run-mode"
          className={selectClass}
          value={effectiveMode}
          onChange={(event) => setMode(event.target.value === 'provider' ? 'provider' : 'local')}
        >
          <option value="local">Local rules</option>
          <option value="provider" disabled={!providerAllowed}>
            Provider checks{providerAllowed ? '' : ' (pick a connection with an API key)'}
          </option>
        </select>
      </div>
      <Button type="submit" disabled={start.isPending}>
        {start.isPending ? 'Starting...' : 'Start run'}
      </Button>
      <p role="alert" className="text-destructive w-full text-sm empty:hidden">
        {start.isError ? describeError(start.error, 'start-run') : null}
      </p>
    </form>
  );
}
