'use client';

import Link from 'next/link';
import { customerPageSchema, type Customer } from '@payscope/shared/records-schemas';
import { CUSTOMER_FILTERS } from './filter-config';
import { formatTimestamp, recordHref } from './format';
import type { Column } from './records-list';
import { RecordsListView } from './records-list-view';

function customerColumns(orgId: string): Column<Customer>[] {
  return [
    {
      header: 'Email',
      cell: (c) => (
        <Link
          href={recordHref(orgId, 'customers', c.id)}
          className="tap-link font-medium underline-offset-4 hover:underline"
        >
          {c.email ?? 'No email'}
        </Link>
      ),
    },
    { header: 'Name', cell: (c) => c.displayName ?? 'Not set' },
    { header: 'External reference', cell: (c) => c.externalRef ?? 'Not set' },
    { header: 'First seen', cell: (c) => formatTimestamp(c.createdAt) },
  ];
}

export function CustomersList({ orgId }: { orgId: string }) {
  return (
    <RecordsListView
      orgId={orgId}
      resource="customers"
      title="Customers"
      description="Provider-neutral customers, each linked to their ids at every provider."
      fields={CUSTOMER_FILTERS}
      schema={customerPageSchema}
      columns={customerColumns(orgId)}
      empty={{
        title: 'No customers yet',
        filteredTitle: 'No customers match this email or provider ID',
        hint: 'Customers appear here once a connected provider delivers webhook events that mention them, or when seed data is loaded.',
      }}
    />
  );
}
