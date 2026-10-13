'use client';

import { findingDetailSchema } from '@payscope/shared/reconciliation-schemas';
import { PayloadViewer } from '@/components/events/payload-viewer';
import {
  BackLink,
  DetailField,
  DetailGrid,
  DetailSection,
  Timestamp,
} from '@/components/records/detail-parts';
import { humanize } from '@/components/records/format';
import { StatusBadge } from '@/components/records/status-badge';
import { useRecordDetail } from '@/components/records/use-record-detail';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { FindingActions } from './finding-actions';

export function FindingDetail({ orgId, findingId }: { orgId: string; findingId: string }) {
  const finding = useRecordDetail(orgId, 'reconciliation/findings', findingId, findingDetailSchema);
  const org = useCurrentOrg(orgId);

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <BackLink href={`/app/${orgId}/findings`}>Findings</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{humanize(finding.type)}</h1>
          <StatusBadge status={finding.severity} />
          <StatusBadge status={finding.status} />
        </div>
        <FindingActions
          orgId={orgId}
          findingId={finding.id}
          type={finding.type}
          status={finding.status}
          role={org.role}
        />
      </div>

      <DetailSection title="Recommended action">
        <p className="text-sm">{finding.recommendedAction}</p>
      </DetailSection>

      <DetailSection title="Details">
        <DetailGrid>
          <DetailField label="Subject">
            {humanize(finding.subjectType)}{' '}
            <span className="text-muted-foreground font-mono text-xs">{finding.subjectId}</span>
          </DetailField>
          <DetailField label="First seen in run">
            <span className="font-mono text-xs">{finding.firstSeenRunId}</span>
          </DetailField>
          <DetailField label="Last seen in run">
            <span className="font-mono text-xs">{finding.lastSeenRunId}</span>
          </DetailField>
          <DetailField label="Created">
            <Timestamp value={finding.createdAt} />
          </DetailField>
          <DetailField label="Resolved">
            <Timestamp value={finding.resolvedAt} />
          </DetailField>
          <DetailField label="Resolution note">
            {finding.resolutionNote ?? <span className="text-muted-foreground">None</span>}
          </DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Evidence">
        <PayloadViewer payload={finding.evidence} />
      </DetailSection>
    </div>
  );
}
