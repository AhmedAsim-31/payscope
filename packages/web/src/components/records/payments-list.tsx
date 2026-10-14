'use client';

import Link from 'next/link';
import { paymentPageSchema, type Payment } from '@payscope/shared/records-schemas';
import { PAYMENT_FILTERS } from './filter-config';
import { formatMoney, formatTimestamp, humanize, recordHref } from './format';
import type { Column } from './records-list';
import { RecordsListView } from './records-list-view';
import { StatusBadge } from './status-badge';

export function paymentColumns(orgId: string): Column<Payment>[] {
  return [
    {
      header: 'Payment',
      cell: (p) => (
        <Link
          href={recordHref(orgId, 'payments', p.id)}
          className="font-mono text-xs underline-offset-4 hover:underline"
        >
          {p.providerPaymentId}
        </Link>
      ),
    },
    { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
    { header: 'Amount', align: 'right', cell: (p) => formatMoney(p.amount) },
    { header: 'Provider', cell: (p) => humanize(p.provider) },
    { header: 'Customer', cell: (p) => p.customer?.email ?? 'Unknown' },
    { header: 'Received', cell: (p) => formatTimestamp(p.createdAt) },
  ];
}

export function PaymentsList({ orgId }: { orgId: string }) {
  return (
    <RecordsListView
      orgId={orgId}
      resource="payments"
      title="Payments"
      description="Charged amounts as reported by your connected providers, newest first."
      fields={PAYMENT_FILTERS}
      schema={paymentPageSchema}
      columns={paymentColumns(orgId)}
      exportable
      empty={{
        title: 'No payments yet',
        filteredTitle: 'No payments match these filters',
        hint: 'Payments appear here once a connected provider delivers webhook events, or when seed data is loaded.',
      }}
    />
  );
}
