'use client';

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { can } from '@payscope/shared/permissions';
import { resetResultSchema, scenarioCatalogSchema } from '@payscope/shared/scenario-schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { apiFetch } from '@/lib/api-client';
import { describeError } from '@/lib/api-messages';
import { ScenarioCard } from './scenario-card';

export function ScenarioLab({ orgId }: { orgId: string }) {
  const org = useCurrentOrg(orgId);
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const canRun = can(org.role, 'scenarios:run');
  const { data } = useSuspenseQuery({
    queryKey: ['orgs', orgId, 'scenarios'],
    queryFn: async () =>
      scenarioCatalogSchema.parse(await apiFetch(`/api/v1/orgs/${orgId}/scenarios`)).data,
  });

  const reset = useMutation({
    mutationFn: async () =>
      resetResultSchema.parse(
        await apiFetch(`/api/v1/orgs/${orgId}/scenarios/reset`, { method: 'POST' }),
      ),
    onSuccess: () => setConfirming(false),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['orgs', orgId] }),
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Scenario lab</h1>
          <p className="text-muted-foreground max-w-prose text-sm">
            Each scenario drives the real pipeline (webhook, job, worker, reconciliation) on a
            dedicated &quot;Scenario lab (demo)&quot; simulation connection, so your other data is
            never touched. Nothing here calls a live provider.
          </p>
        </div>
        {canRun ? (
          <Button type="button" variant="outline" onClick={() => setConfirming(true)}>
            Reset scenario lab
          </Button>
        ) : null}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((scenario) => (
          <ScenarioCard key={scenario.id} orgId={orgId} scenario={scenario} canRun={canRun} />
        ))}
      </div>
      {confirming ? (
        <Dialog
          open
          onOpenChange={(next) => (next || reset.isPending ? undefined : setConfirming(false))}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset the scenario lab?</DialogTitle>
              <DialogDescription>
                This deletes the scenario-lab connection, its events, records and run history for
                this organization. Seed and real data are not affected.
              </DialogDescription>
            </DialogHeader>
            <p role="alert" className="text-destructive text-sm empty:hidden">
              {reset.isError ? describeError(reset.error, 'reset-scenarios') : null}
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={reset.isPending}
                onClick={() => setConfirming(false)}
              >
                Cancel
              </Button>
              <Button type="button" disabled={reset.isPending} onClick={() => reset.mutate()}>
                {reset.isPending ? 'Resetting...' : 'Reset'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
