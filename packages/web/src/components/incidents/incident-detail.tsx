'use client';

import { incidentDetailSchema } from '@payscope/shared/incident-schemas';
import { FINDING_TYPES } from '@payscope/shared/reconciliation-schemas';
import Link from 'next/link';
import { z } from 'zod';
import {
  BackLink,
  DetailField,
  DetailGrid,
  DetailSection,
  SectionEmpty,
  Timestamp,
} from '@/components/records/detail-parts';
import { humanize } from '@/components/records/format';
import { StatusBadge } from '@/components/records/status-badge';
import { useRecordDetail } from '@/components/records/use-record-detail';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { IncidentActions } from './incident-actions';

export function IncidentDetail({ orgId, incidentId }: { orgId: string; incidentId: string }) {
  const incident = useRecordDetail(orgId, 'incidents', incidentId, incidentDetailSchema);
  const org = useCurrentOrg(orgId);
  const { findingType, lastRunId } = incident.related;
  const findingsType = FINDING_TYPES.find((t) => t === findingType);
  const runId = z.uuid().safeParse(lastRunId).data;
  const findingsQuery = new URLSearchParams({
    type: findingsType ?? '',
    ...(runId ? { runId } : {}),
  });

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <BackLink href={`/app/${orgId}/incidents`}>Incidents</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{incident.title}</h1>
          <StatusBadge status={incident.severity} />
          <StatusBadge status={incident.status} />
        </div>
      </div>

      <DetailSection title="Details">
        <DetailGrid>
          <DetailField label="Category">{humanize(incident.category)}</DetailField>
          <DetailField label="Active findings">
            <span className="inline-flex flex-wrap items-baseline gap-2">
              {incident.findingCount}
              {findingsType ? (
                <Link
                  href={`/app/${orgId}/findings?${findingsQuery}`}
                  className="underline underline-offset-4"
                >
                  View findings
                </Link>
              ) : null}
            </span>
          </DetailField>
          <DetailField label="Opened">
            <Timestamp value={incident.openedAt} />
          </DetailField>
          <DetailField label="Last seen">
            <Timestamp value={incident.lastSeenAt} />
          </DetailField>
          <DetailField label="Resolved">
            <Timestamp value={incident.resolvedAt} />
          </DetailField>
          <DetailField label="Resolution notes">
            {incident.resolutionNotes ?? <span className="text-muted-foreground">None</span>}
          </DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Respond">
        <IncidentActions
          orgId={orgId}
          incidentId={incident.id}
          status={incident.status}
          role={org.role}
        />
      </DetailSection>

      <DetailSection title="Timeline">
        {incident.actions.length === 0 ? (
          <SectionEmpty>No actions recorded yet.</SectionEmpty>
        ) : (
          <ol className="grid gap-3">
            {incident.actions.map((action) => (
              <li key={action.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{humanize(action.action)}</span>
                  <span className="text-muted-foreground text-xs">
                    <Timestamp value={action.createdAt} />
                  </span>
                </div>
                {action.note ? <p className="mt-1">{action.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </DetailSection>
    </div>
  );
}
