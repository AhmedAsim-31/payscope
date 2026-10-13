'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { incidentDetailSchema, type INCIDENT_ACTIONS } from '@payscope/shared/incident-schemas';
import { can, type Role } from '@payscope/shared/permissions';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';
import { describeError } from '@/lib/api-messages';

type Action = (typeof INCIDENT_ACTIONS)[number];

export function IncidentActions({
  orgId,
  incidentId,
  status,
  role,
}: {
  orgId: string;
  incidentId: string;
  status: string;
  role: Role;
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const act = useMutation({
    mutationFn: async (action: Action) =>
      incidentDetailSchema.parse(
        await apiFetch(`/api/v1/orgs/${orgId}/incidents/${incidentId}/actions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, note: note.trim() }),
        }),
      ),
    onSuccess: () => setNote(''),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId] }),
  });

  if (!can(role, 'findings:update')) return null;
  const empty = note.trim().length === 0;
  const resolved = status === 'resolved';

  return (
    <div className="grid max-w-xl gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="incident-note">Note</Label>
        <Input
          id="incident-note"
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={empty || act.isPending || status !== 'open'}
          onClick={() => act.mutate('acknowledge')}
        >
          Acknowledge
        </Button>
        <Button
          variant="outline"
          disabled={empty || act.isPending}
          onClick={() => act.mutate('note')}
        >
          Add note
        </Button>
        <Button disabled={empty || act.isPending || resolved} onClick={() => act.mutate('resolve')}>
          Resolve
        </Button>
      </div>
      <p role="alert" className="text-destructive text-sm empty:hidden">
        {act.isError ? describeError(act.error, 'incident-action') : null}
      </p>
    </div>
  );
}
