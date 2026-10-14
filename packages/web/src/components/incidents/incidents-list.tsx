'use client';

import Link from 'next/link';
import { incidentPageSchema, type Incident } from '@payscope/shared/incident-schemas';
import { INCIDENT_FILTERS } from '@/components/records/filter-config';
import { formatTimestamp, recordHref } from '@/components/records/format';
import type { Column } from '@/components/records/records-list';
import { RecordsListView } from '@/components/records/records-list-view';
import { StatusBadge } from '@/components/records/status-badge';

function columns(orgId: string): Column<Incident>[] {
  return [
    {
      header: 'Incident',
      cell: (i) => (
        <Link
          href={recordHref(orgId, 'incidents', i.id)}
          className="underline-offset-4 hover:underline"
        >
          {i.title}
        </Link>
      ),
    },
    { header: 'Severity', cell: (i) => <StatusBadge status={i.severity} /> },
    { header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
    { header: 'Findings', align: 'right', cell: (i) => i.findingCount },
    { header: 'Opened', cell: (i) => formatTimestamp(i.openedAt) },
    { header: 'Last seen', cell: (i) => formatTimestamp(i.lastSeenAt) },
  ];
}

export function IncidentsList({ orgId }: { orgId: string }) {
  return (
    <RecordsListView
      orgId={orgId}
      resource="incidents"
      title="Incidents"
      description="High and critical findings are grouped into one incident per finding type."
      fields={INCIDENT_FILTERS}
      schema={incidentPageSchema}
      columns={columns(orgId)}
      empty={{
        title: 'No incidents',
        filteredTitle: 'No incidents match these filters',
        hint: 'An incident opens automatically when a reconciliation run finds a high or critical inconsistency.',
      }}
    />
  );
}
