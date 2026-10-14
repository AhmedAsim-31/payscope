'use client';

import Link from 'next/link';
import { auditPageSchema, type AuditEntry } from '@payscope/shared/audit-schemas';
import { AUDIT_FILTERS } from '@/components/records/filter-config';
import { formatTimestamp, recordHref } from '@/components/records/format';
import type { Column } from '@/components/records/records-list';
import { RecordsListView } from '@/components/records/records-list-view';
import { StatusBadge } from '@/components/records/status-badge';

const TARGET_RESOURCES: Record<string, string> = {
  payment: 'payments',
  subscription: 'subscriptions',
  customer: 'customers',
  entitlement: 'entitlements',
  incident: 'incidents',
  finding: 'findings',
  reconciliation_run: 'reconciliation',
  event: 'events',
};

function targetHref(orgId: string, e: AuditEntry): string | null {
  if (!e.targetId) return null;
  if (e.targetType === 'connection') return `/app/${orgId}/connections`;
  const resource = TARGET_RESOURCES[e.targetType];
  return resource ? recordHref(orgId, resource, e.targetId) : null;
}

function Actor({ entry: e }: { entry: AuditEntry }) {
  if (e.actorEmail) return <span className="text-xs break-all">{e.actorEmail}</span>;
  if (e.actorId) return <span className="font-mono text-xs">{e.actorId.slice(0, 8)}</span>;
  return <span className="text-muted-foreground">System</span>;
}

function Target({ orgId, entry: e }: { orgId: string; entry: AuditEntry }) {
  const label = `${e.targetType}${e.targetId ? `:${e.targetId.slice(0, 8)}` : ''}`;
  const href = targetHref(orgId, e);
  return href ? (
    <Link href={href} className="font-mono text-xs break-all underline-offset-4 hover:underline">
      {label}
    </Link>
  ) : (
    <span className="font-mono text-xs break-all">{label}</span>
  );
}

export const auditColumns = (orgId: string): Column<AuditEntry>[] => [
  { header: 'When', cell: (e) => formatTimestamp(e.createdAt) },
  { header: 'Action', cell: (e) => <span className="font-mono text-xs">{e.action}</span> },
  { header: 'Outcome', cell: (e) => <StatusBadge status={e.outcome} /> },
  { header: 'Actor', cell: (e) => <Actor entry={e} /> },
  { header: 'Target', cell: (e) => <Target orgId={orgId} entry={e} /> },
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
      columns={auditColumns(orgId)}
      empty={{
        title: 'No audit entries yet',
        filteredTitle: 'No entries match these filters',
        hint: 'Entries are written whenever a member, connection, run, finding, or repair changes.',
      }}
    />
  );
}
