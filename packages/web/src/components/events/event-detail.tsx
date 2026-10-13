'use client';

import { eventDetailSchema, type EventJob } from '@payscope/shared/events-schemas';
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
import { AttemptsTimeline } from './attempts-timeline';
import { PayloadViewer } from './payload-viewer';
import { RetryEventButton } from './retry-event-button';

function JobPanel({ job }: { job: EventJob | null }) {
  if (!job) return <SectionEmpty>No job is linked to this event.</SectionEmpty>;
  return (
    <DetailGrid>
      <DetailField label="Job status">
        <StatusBadge status={job.status} />
      </DetailField>
      <DetailField label="Attempts used">
        {job.attemptCount} of {job.maxAttempts}
      </DetailField>
      <DetailField label={job.status === 'queued' ? 'Next run' : 'Available at'}>
        <Timestamp value={job.availableAt} />
      </DetailField>
      <DetailField label="Last error">
        {job.lastError ? (
          <span className="font-mono text-xs">{job.lastError}</span>
        ) : (
          <span className="text-muted-foreground">None</span>
        )}
      </DetailField>
    </DetailGrid>
  );
}

export function EventDetail({ orgId, eventId }: { orgId: string; eventId: string }) {
  const event = useRecordDetail(orgId, 'events', eventId, eventDetailSchema);
  const org = useCurrentOrg(orgId);

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <BackLink href={`/app/${orgId}/events`}>Events</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold break-all">{event.providerEventId}</h1>
          <StatusBadge status={event.status} />
        </div>
        <RetryEventButton orgId={orgId} eventId={event.id} status={event.status} role={org.role} />
      </div>

      <DetailSection title="Details">
        <DetailGrid>
          <DetailField label="Provider">{humanize(event.provider)}</DetailField>
          <DetailField label="Type">
            <span className="font-mono text-xs">{event.eventType}</span>
          </DetailField>
          <DetailField label="Normalized type">
            {event.normalizedType ?? <span className="text-muted-foreground">Not set</span>}
          </DetailField>
          <DetailField label="Occurred (provider time)">
            <Timestamp value={event.occurredAt} />
          </DetailField>
          <DetailField label="Received (first seen by PayScope)">
            <Timestamp value={event.receivedAt} />
          </DetailField>
          <DetailField label="Processed">
            <Timestamp value={event.processedAt} />
          </DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Processing attempts">
        <AttemptsTimeline attempts={event.attempts} />
      </DetailSection>

      <DetailSection title="Job">
        <JobPanel job={event.job} />
      </DetailSection>

      <DetailSection title="Payload">
        <PayloadViewer payload={event.payload} />
      </DetailSection>
    </div>
  );
}
