'use client';

import { PageHeader } from '@/components/page-header';
import Link from 'next/link';
import { runPageSchema, type ReconciliationRun } from '@payscope/shared/reconciliation-schemas';
import { formatTimestamp, humanize } from '@/components/records/format';
import { RecordsList, type Column } from '@/components/records/records-list';
import { StatusBadge } from '@/components/records/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { Suspense } from 'react';
import { StartRunForm } from './start-run-form';

const COLUMNS: Column<ReconciliationRun>[] = [
  { header: 'Started', cell: (r) => formatTimestamp(r.startedAt) },
  { header: 'Mode', cell: (r) => humanize(r.mode) },
  { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { header: 'Examined', align: 'right', cell: (r) => r.counts.examined },
  { header: 'Mismatched', align: 'right', cell: (r) => r.counts.mismatched },
  { header: 'Unavailable', align: 'right', cell: (r) => r.counts.unavailable },
  { header: 'Failed', align: 'right', cell: (r) => r.counts.failed },
  {
    header: 'Note',
    cell: (r) => r.error ?? <span className="text-muted-foreground">None</span>,
  },
];

export function RunsView({ orgId }: { orgId: string }) {
  const org = useCurrentOrg(orgId);
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Reconciliation"
        description={
          <>
            Runs compare PayScope records with each other and, in provider mode, with the provider.
            Results appear as{' '}
            <Link className="underline" href={`/app/${orgId}/findings`}>
              findings
            </Link>
            .
          </>
        }
      />
      <Suspense fallback={<Skeleton className="h-16 w-full" />}>
        <StartRunForm orgId={orgId} role={org.role} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-44 w-full" />}>
        <RecordsList
          orgId={orgId}
          resource="reconciliation/runs"
          schema={runPageSchema}
          params={{}}
          columns={COLUMNS}
          caption="Reconciliation runs"
          pollWhile={(run) => run.status === 'running'}
          isFiltered={false}
          empty={{
            title: 'No runs yet',
            filteredTitle: 'No runs',
            hint: 'Start a local run to check payments, subscriptions, and entitlements for inconsistencies.',
          }}
        />
      </Suspense>
    </div>
  );
}
