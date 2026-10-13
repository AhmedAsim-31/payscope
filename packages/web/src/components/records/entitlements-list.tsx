'use client';

import Link from 'next/link';
import { entitlementPageSchema, type Entitlement } from '@payscope/shared/records-schemas';
import { ENTITLEMENT_FILTERS } from './filter-config';
import { formatTimestamp, humanize, recordHref } from './format';
import type { Column } from './records-list';
import { RecordsListView } from './records-list-view';
import { StatusBadge } from './status-badge';

function entitlementColumns(orgId: string): Column<Entitlement>[] {
  return [
    {
      header: 'Entitlement',
      cell: (e) => (
        <Link
          href={recordHref(orgId, 'entitlements', e.id)}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {e.entitlementKey}
        </Link>
      ),
    },
    { header: 'State', cell: (e) => <StatusBadge status={e.state} /> },
    { header: 'Customer', cell: (e) => e.customer.email ?? 'Unknown' },
    { header: 'Source', cell: (e) => humanize(e.source) },
    {
      header: 'Expires',
      cell: (e) => (e.expiresAt ? formatTimestamp(e.expiresAt) : 'No expiry'),
    },
  ];
}

export function EntitlementsList({ orgId }: { orgId: string }) {
  return (
    <RecordsListView
      orgId={orgId}
      resource="entitlements"
      title="Entitlements"
      description="The access each customer should currently have."
      fields={ENTITLEMENT_FILTERS}
      schema={entitlementPageSchema}
      columns={entitlementColumns(orgId)}
      empty={{
        title: 'No entitlements yet',
        filteredTitle: 'No entitlements match these filters',
        hint: 'Entitlements appear here once subscription events are processed, or when seed data is loaded.',
      }}
    />
  );
}
