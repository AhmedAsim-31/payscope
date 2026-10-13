'use client';

import { findingPageSchema, runDetailSchema } from '@payscope/shared/reconciliation-schemas';
import {
  BackLink,
  DetailField,
  DetailGrid,
  DetailSection,
  Timestamp,
} from '@/components/records/detail-parts';
import { formatTimestamp, humanize } from '@/components/records/format';
import { RelatedRecords } from '@/components/records/related-records';
import { StatusBadge } from '@/components/records/status-badge';
import { useRecordDetail } from '@/components/records/use-record-detail';
import { findingColumns } from './findings-list';

const none = <span className="text-muted-foreground">None</span>;

export function RunDetail({ orgId, runId }: { orgId: string; runId: string }) {
  const run = useRecordDetail(orgId, 'reconciliation/runs', runId, runDetailSchema);

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <BackLink href={`/app/${orgId}/reconciliation`}>Reconciliation</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">Run {formatTimestamp(run.startedAt)}</h1>
          <StatusBadge status={run.status} />
        </div>
      </div>

      <DetailSection title="Details">
        <DetailGrid>
          <DetailField label="Mode">{humanize(run.mode)}</DetailField>
          <DetailField label="Trigger">{humanize(run.trigger)}</DetailField>
          <DetailField label="Started">
            <Timestamp value={run.startedAt} />
          </DetailField>
          <DetailField label="Finished">
            <Timestamp value={run.finishedAt} />
          </DetailField>
          <DetailField label="Connection">
            {run.connectionId ? (
              <span className="font-mono text-xs">{run.connectionId}</span>
            ) : (
              none
            )}
          </DetailField>
          <DetailField label="Note">{run.error ?? none}</DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Counts">
        <DetailGrid>
          {Object.entries(run.counts).map(([key, value]) => (
            <DetailField key={key} label={humanize(key)}>
              {value}
            </DetailField>
          ))}
        </DetailGrid>
      </DetailSection>

      <RelatedRecords
        orgId={orgId}
        title="Findings"
        resource="reconciliation/findings"
        listPath="findings"
        viewAllLabel="View all findings"
        schema={findingPageSchema}
        params={{ runId: run.id }}
        columns={findingColumns(orgId)}
        empty={{
          title: 'No findings',
          hint: 'Findings this run first detected or last saw appear here.',
        }}
      />
    </div>
  );
}
