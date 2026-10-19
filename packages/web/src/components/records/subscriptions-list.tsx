'use client';

import Link from 'next/link';
import { subscriptionPageSchema, type Subscription } from '@payscope/shared/records-schemas';
import { SUBSCRIPTION_FILTERS } from './filter-config';
import { formatTimestamp, humanize, recordHref } from './format';
import type { Column } from './records-list';
import { RecordsListView } from './records-list-view';
import { StatusBadge } from './status-badge';

function subscriptionColumns(orgId: string): Column<Subscription>[] {
  return [
    {
      header: 'Subscription',
      cell: (s) => (
        <Link
          href={recordHref(orgId, 'subscriptions', s.id)}
          className="tap-link font-mono text-xs underline-offset-4 hover:underline"
        >
          {s.providerSubscriptionId}
        </Link>
      ),
    },
    { header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
    { header: 'Plan', cell: (s) => s.planRef ?? 'Not set' },
    { header: 'Customer', cell: (s) => s.customer.email ?? 'Unknown' },
    { header: 'Provider', cell: (s) => humanize(s.provider) },
    {
      header: 'Period ends',
      cell: (s) => (s.currentPeriodEnd ? formatTimestamp(s.currentPeriodEnd) : 'Not recorded'),
    },
  ];
}

export function SubscriptionsList({ orgId }: { orgId: string }) {
  return (
    <RecordsListView
      orgId={orgId}
      resource="subscriptions"
      title="Subscriptions"
      description="Subscription state as last reported by each provider."
      fields={SUBSCRIPTION_FILTERS}
      schema={subscriptionPageSchema}
      columns={subscriptionColumns(orgId)}
      empty={{
        title: 'No subscriptions yet',
        filteredTitle: 'No subscriptions match these filters',
        hint: 'Subscriptions appear here once a connected provider delivers webhook events, or when seed data is loaded.',
      }}
    />
  );
}
