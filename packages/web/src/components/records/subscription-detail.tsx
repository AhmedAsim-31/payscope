'use client';

import Link from 'next/link';
import { eventPageSchema } from '@payscope/shared/events-schemas';
import { findingPageSchema } from '@payscope/shared/reconciliation-schemas';
import { paymentPageSchema, subscriptionDetailSchema } from '@payscope/shared/records-schemas';
import { eventColumns } from '@/components/events/events-list';
import { findingColumns } from '@/components/reconciliation/findings-list';
import {
  BackLink,
  DetailField,
  DetailGrid,
  DetailSection,
  SectionEmpty,
  Timestamp,
} from './detail-parts';
import { humanize, recordHref } from './format';
import { paymentColumns } from './payments-list';
import { RelatedRecords } from './related-records';
import { StatusBadge } from './status-badge';
import { useRecordDetail } from './use-record-detail';

export function SubscriptionDetail({
  orgId,
  subscriptionId,
}: {
  orgId: string;
  subscriptionId: string;
}) {
  const sub = useRecordDetail(orgId, 'subscriptions', subscriptionId, subscriptionDetailSchema);

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <BackLink href={`/app/${orgId}/subscriptions`}>Subscriptions</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold break-all">
            {sub.providerSubscriptionId}
          </h1>
          <StatusBadge status={sub.status} />
        </div>
      </div>

      <DetailSection title="Details">
        <DetailGrid>
          <DetailField label="Provider">{humanize(sub.provider)}</DetailField>
          <DetailField label="Plan">{sub.planRef ?? 'Not set'}</DetailField>
          <DetailField label="Customer">
            <Link
              href={recordHref(orgId, 'customers', sub.customer.id)}
              className="tap-link underline underline-offset-4"
            >
              {sub.customer.email ?? sub.customer.id}
            </Link>
          </DetailField>
          <DetailField label="Current period starts">
            <Timestamp value={sub.currentPeriodStart} />
          </DetailField>
          <DetailField label="Current period ends">
            <Timestamp value={sub.currentPeriodEnd} />
          </DetailField>
          <DetailField label="Cancels at period end">
            {sub.cancelAtPeriodEnd ? 'Yes' : 'No'}
          </DetailField>
          <DetailField label="Canceled">
            <Timestamp value={sub.canceledAt} />
          </DetailField>
          <DetailField label="Ended">
            <Timestamp value={sub.endedAt} />
          </DetailField>
          <DetailField label="First seen by PayScope">
            <Timestamp value={sub.createdAt} />
          </DetailField>
          <DetailField label="Last event applied">
            <Timestamp value={sub.lastEventAt} />
          </DetailField>
          <DetailField label="Record updated">
            <Timestamp value={sub.updatedAt} />
          </DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Entitlements">
        {sub.entitlements.length === 0 ? (
          <SectionEmpty>No entitlements are linked to this subscription.</SectionEmpty>
        ) : (
          <ul className="grid gap-2">
            {sub.entitlements.map((entitlement) => (
              <li key={entitlement.id} className="flex flex-wrap items-center gap-2">
                <Link
                  href={recordHref(orgId, 'entitlements', entitlement.id)}
                  className="tap-link font-mono text-sm underline underline-offset-4"
                >
                  {entitlement.entitlementKey}
                </Link>
                <StatusBadge status={entitlement.state} />
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <RelatedRecords
        orgId={orgId}
        title="Payments"
        resource="payments"
        listPath="payments"
        viewAllLabel="View all payments"
        schema={paymentPageSchema}
        params={{ subscriptionId: sub.id }}
        columns={paymentColumns(orgId)}
        empty={{
          title: 'No payments yet',
          hint: 'Payments the provider attributes to this subscription appear here.',
        }}
      />

      <RelatedRecords
        orgId={orgId}
        title="Provider events"
        resource="events"
        listPath="events"
        viewAllLabel="View all events"
        schema={eventPageSchema}
        params={{ connectionId: sub.connectionId, objectRef: sub.providerSubscriptionId }}
        columns={eventColumns(orgId)}
        empty={{
          title: 'No events yet',
          hint: 'Events that reference this subscription appear here as webhooks are ingested.',
        }}
      />

      <RelatedRecords
        orgId={orgId}
        title="Reconciliation findings"
        resource="reconciliation/findings"
        listPath="findings"
        viewAllLabel="View all findings"
        schema={findingPageSchema}
        params={{ subjectType: 'subscription', subjectId: sub.id }}
        columns={findingColumns(orgId)}
        empty={{
          title: 'No findings',
          hint: 'Reconciliation has not flagged this subscription. Findings appear here after a run detects a discrepancy.',
        }}
      />
    </div>
  );
}
