'use client';

import Link from 'next/link';
import { auditPageSchema } from '@payscope/shared/audit-schemas';
import { paymentDetailSchema } from '@payscope/shared/records-schemas';
import {
  BackLink,
  DetailField,
  DetailGrid,
  DetailSection,
  SectionEmpty,
  Timestamp,
} from './detail-parts';
import { AUDIT_COLUMNS } from '@/components/audit/audit-list';
import { formatMoney, humanize, recordHref } from './format';
import { RelatedRecords } from './related-records';
import { StatusBadge } from './status-badge';
import { useRecordDetail } from './use-record-detail';

export function PaymentDetail({ orgId, paymentId }: { orgId: string; paymentId: string }) {
  const payment = useRecordDetail(orgId, 'payments', paymentId, paymentDetailSchema);

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <BackLink href={`/app/${orgId}/payments`}>Payments</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold break-all">{payment.providerPaymentId}</h1>
          <StatusBadge status={payment.status} />
        </div>
      </div>

      <DetailSection title="Amount">
        <p className="text-3xl font-semibold tabular-nums">{formatMoney(payment.amount)}</p>
        <p className="text-muted-foreground text-sm">
          Amount is the charged amount, not net payout. Provider fees and taxes are not deducted.
        </p>
        <DetailGrid>
          <DetailField label="Refunded">{formatMoney(payment.amountRefunded)}</DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Details">
        <DetailGrid>
          <DetailField label="Provider">{humanize(payment.provider)}</DetailField>
          <DetailField label="Customer">
            {payment.customer ? (
              <Link
                href={recordHref(orgId, 'customers', payment.customer.id)}
                className="underline underline-offset-4"
              >
                {payment.customer.email ?? payment.customer.id}
              </Link>
            ) : (
              <span className="text-muted-foreground">Unknown</span>
            )}
          </DetailField>
          <DetailField label="Provider time (created at the provider)">
            <Timestamp value={payment.providerCreatedAt} />
          </DetailField>
          <DetailField label="Received time (first seen by PayScope)">
            <Timestamp value={payment.createdAt} />
          </DetailField>
          <DetailField label="Last event applied">
            <Timestamp value={payment.lastEventAt} />
          </DetailField>
          <DetailField label="Record updated">
            <Timestamp value={payment.updatedAt} />
          </DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Related provider events">
        {payment.events.length === 0 ? (
          <SectionEmpty>
            No provider events reference this payment yet. Events appear here as webhooks for this
            payment are ingested.
          </SectionEmpty>
        ) : (
          <ol className="grid gap-3 border-l pl-4">
            {payment.events.map((event) => (
              <li key={event.id} className="grid gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm break-all">{event.eventType}</span>
                  <StatusBadge status={event.status} />
                </div>
                <p className="text-muted-foreground text-xs">
                  Provider time: <Timestamp value={event.occurredAt} />
                </p>
                <p className="text-muted-foreground text-xs">
                  Received: <Timestamp value={event.receivedAt} />
                </p>
              </li>
            ))}
          </ol>
        )}
      </DetailSection>

      <RelatedRecords
        orgId={orgId}
        title="Audit history"
        resource="audit"
        listPath="audit"
        viewAllLabel="View all audit entries"
        schema={auditPageSchema}
        params={{ targetType: 'payment', targetId: payment.id }}
        columns={AUDIT_COLUMNS}
        empty={{
          title: 'No audit entries yet',
          hint: 'Repairs and other audited actions on this payment appear here.',
        }}
      />
    </div>
  );
}
