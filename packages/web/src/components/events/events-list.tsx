'use client';

import Link from 'next/link';
import { eventPageSchema, type EventSummary } from '@payscope/shared/events-schemas';
import { EVENT_FILTERS } from '@/components/records/filter-config';
import { formatTimestamp, humanize, recordHref } from '@/components/records/format';
import type { Column } from '@/components/records/records-list';
import { RecordsListView } from '@/components/records/records-list-view';
import { StatusBadge } from '@/components/records/status-badge';

function eventColumns(orgId: string): Column<EventSummary>[] {
  return [
    { header: 'Received', cell: (e) => formatTimestamp(e.receivedAt) },
    { header: 'Provider', cell: (e) => humanize(e.provider) },
    {
      header: 'Type',
      cell: (e) => (
        <Link
          href={recordHref(orgId, 'events', e.id)}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {e.eventType}
        </Link>
      ),
    },
    {
      header: 'Normalized type',
      cell: (e) => e.normalizedType ?? <span className="text-muted-foreground">Not set</span>,
    },
    { header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
    { header: 'Attempts', align: 'right', cell: (e) => e.attemptCount },
  ];
}

export function EventsList({ orgId }: { orgId: string }) {
  return (
    <RecordsListView
      orgId={orgId}
      resource="events"
      title="Events"
      description="Webhook events received from your connected providers, newest first."
      fields={EVENT_FILTERS}
      schema={eventPageSchema}
      columns={eventColumns(orgId)}
      empty={{
        title: 'No events yet',
        filteredTitle: 'No events match these filters',
        hint: 'Events arrive when a provider sends a webhook to the webhook URL shown on its connection. Add a connection and point the provider at that URL.',
      }}
    />
  );
}
