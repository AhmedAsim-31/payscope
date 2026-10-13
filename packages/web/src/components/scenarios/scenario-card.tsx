'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  scenarioRunSchema,
  type ScenarioCatalogItem,
  type ScenarioRun,
} from '@payscope/shared/scenario-schemas';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';
import { describeError } from '@/lib/api-messages';
import { ScenarioResult } from './scenario-result';

type Props = { orgId: string; scenario: ScenarioCatalogItem; canRun: boolean };

const POLL_MS = 1000;

export function ScenarioCard({ orgId, scenario, canRun }: Props) {
  const queryClient = useQueryClient();
  const [runId, setRunId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const base = `/api/v1/orgs/${orgId}`;

  const polled = useQuery({
    queryKey: ['orgs', orgId, 'scenario-runs', runId],
    enabled: runId !== null,
    queryFn: async () => scenarioRunSchema.parse(await apiFetch(`${base}/scenario-runs/${runId}`)),
    refetchInterval: (query) => (query.state.data?.status === 'running' ? POLL_MS : false),
  });

  const start = useMutation({
    mutationFn: async () =>
      scenarioRunSchema.parse(
        await apiFetch(`${base}/scenarios/${scenario.id}/run`, { method: 'POST' }),
      ),
    onSuccess: (run) => setRunId(run.id),
  });

  const run: ScenarioRun | null = polled.data ?? start.data ?? scenario.lastRun;
  const isBusy = isStarting || (run?.status === 'running' && runId !== null);
  const finished = polled.data !== undefined && polled.data.status !== 'running';

  useEffect(() => {
    if (finished) {
      queryClient
        .invalidateQueries({ queryKey: ['orgs', orgId, 'scenarios'] })
        .catch(() => undefined);
    }
  }, [finished, orgId, queryClient]);

  function handleRun() {
    setIsStarting(true);
    start.mutate(undefined, { onSettled: () => setIsStarting(false) });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>
            {scenario.number}. {scenario.title}
          </CardTitle>
          <Badge variant="outline">{scenario.mode}</Badge>
        </div>
        <CardDescription>{scenario.simulates}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p>
          <span className="font-medium">Expected outcome: </span>
          {scenario.expectedOutcome}
        </p>
        <p className="text-muted-foreground">Changes: {scenario.recordsChanged}</p>
        {canRun ? (
          <div>
            <Button type="button" size="sm" disabled={isBusy} onClick={handleRun}>
              {isBusy ? 'Running...' : 'Run scenario'}
            </Button>
          </div>
        ) : null}
        <p role="alert" className="text-destructive empty:hidden">
          {start.isError ? describeError(start.error, 'run-scenario') : null}
        </p>
        {run ? <ScenarioResult orgId={orgId} run={run} /> : null}
      </CardContent>
    </Card>
  );
}
