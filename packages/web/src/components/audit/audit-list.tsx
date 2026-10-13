'use client';

import { auditPageSchema, type AuditEntry } from '@payscope/shared/audit-schemas';
import { AUDIT_FILTERS } from '@/components/records/filter-config';
import { formatTimestamp } from '@/components/records/format';
import type { Column } from '@/components/records/records-list';
import { RecordsListView } from '@/components/records/records-list-view';
import { StatusBadge } from '@/components/records/status-badge';

export const AUDIT_COLUMNS: Column<AuditEntry>[] = [
  { header: 'When', cell: (e) => formatTimestamp(e.createdAt) },
  { header: 'Action', cell: (e) => <span className="font-mono text-xs">{e.action}</span> },
  { header: 'Outcome', cell: (e) => <StatusBadge status={e.outcome} /> },
  {
    header: 'Actor',
    cell: (e) =>
      e.actorId ? (
        <span className="font-mono text-xs">{e.actorId.slice(0, 8)}</span>
      ) : (
        <span className="text-muted-foreground">System</span>
      ),
  },
  {
    header: 'Target',
    cell: (e) => (
      <span className="font-mono text-xs break-all">
        {e.targetType}
        {e.targetId ? `:${e.targetId.slice(0, 8)}` : ''}
      </span>
    ),
  },
  {
    header: 'Reason',
    cell: (e) => e.reason ?? <span className="text-muted-foreground">None</span>,
  },
  {
    header: 'State change',
    cell: (e) =>
      e.previousState || e.resultingState ? (
        <details>
          <summary className="cursor-pointer text-xs underline-offset-4 hover:underline">
            View
          </summary>
          <pre className="bg-muted mt-1 max-h-48 overflow-auto rounded-md p-2 font-mono text-xs">
            {JSON.stringify({ previous: e.previousState, resulting: e.resultingState }, null, 2)}
          </pre>
        </details>
      ) : (
        <span className="text-muted-foreground">None</span>
      ),
  },
];

export function AuditList({ orgId }: { orgId: string }) {
  return (
    <RecordsListView
      orgId={orgId}
      resource="audit"
      title="Audit log"
      description="Append-only record of who changed what. Entries cannot be edited or deleted."
      fields={AUDIT_FILTERS}
      schema={auditPageSchema}
      columns={AUDIT_COLUMNS}
      empty={{
        title: 'No audit entries yet',
        filteredTitle: 'No entries match these filters',
        hint: 'Entries are written whenever a member, connection, run, finding, or repair changes.',
      }}
    />
  );
}
