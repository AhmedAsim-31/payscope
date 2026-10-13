'use client';

import Link from 'next/link';
import { findingPageSchema, type Finding } from '@payscope/shared/reconciliation-schemas';
import { FINDING_FILTERS } from '@/components/records/filter-config';
import { formatTimestamp, humanize, recordHref } from '@/components/records/format';
import type { Column } from '@/components/records/records-list';
import { RecordsListView } from '@/components/records/records-list-view';
import { StatusBadge } from '@/components/records/status-badge';

export function findingColumns(orgId: string): Column<Finding>[] {
  return [
    {
      header: 'Type',
      cell: (f) => (
        <Link
          href={recordHref(orgId, 'findings', f.id)}
          className="underline-offset-4 hover:underline"
        >
          {humanize(f.type)}
        </Link>
      ),
    },
    { header: 'Severity', cell: (f) => <StatusBadge status={f.severity} /> },
    { header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
    { header: 'Subject', cell: (f) => humanize(f.subjectType) },
    { header: 'Last updated', cell: (f) => formatTimestamp(f.updatedAt) },
  ];
}

export function FindingsList({ orgId }: { orgId: string }) {
  return (
    <RecordsListView
      orgId={orgId}
      resource="reconciliation/findings"
      title="Findings"
      description="Inconsistencies found by reconciliation runs, newest first."
      fields={FINDING_FILTERS}
      schema={findingPageSchema}
      columns={findingColumns(orgId)}
      empty={{
        title: 'No findings yet',
        filteredTitle: 'No findings match these filters',
        hint: 'Start a reconciliation run. Findings appear here when local data disagrees with itself or with the provider.',
      }}
    />
  );
}
