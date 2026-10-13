'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RETRYABLE_EVENT_STATUSES, retryResultSchema } from '@payscope/shared/events-schemas';
import { can, type Role } from '@payscope/shared/permissions';
import { ConfirmDialog } from '@/components/members/confirm-dialog';
import { Button } from '@/components/ui/button';
import { apiFetch } from '@/lib/api-client';
import { describeError } from '@/lib/api-messages';

type RetryEventButtonProps = { orgId: string; eventId: string; status: string; role: Role };

export function RetryEventButton({ orgId, eventId, status, role }: RetryEventButtonProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const retry = useMutation({
    mutationFn: async () =>
      retryResultSchema.parse(
        await apiFetch(`/api/v1/orgs/${orgId}/events/${eventId}/retry`, { method: 'POST' }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId] }),
  });

  const retryable = (RETRYABLE_EVENT_STATUSES as readonly string[]).includes(status);
  if (!can(role, 'jobs:retry') || !retryable) return null;

  return (
    <div className="grid gap-2">
      <div>
        <Button
          onClick={() => {
            retry.reset();
            setOpen(true);
          }}
          disabled={retry.isPending}
        >
          Retry processing
        </Button>
      </div>
      <p role="alert" className="text-destructive text-sm empty:hidden">
        {retry.isError ? describeError(retry.error, 'retry-event') : null}
      </p>
      <ConfirmDialog
        open={open}
        title="Retry processing this event?"
        description="The event goes back to pending and its job is queued to run again right away, with three more attempts allowed. Events that already processed successfully are never re-run."
        confirmLabel="Retry processing"
        isPending={retry.isPending}
        onConfirm={() => retry.mutate(undefined, { onSettled: () => setOpen(false) })}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
