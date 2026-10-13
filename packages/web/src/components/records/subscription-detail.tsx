'use client';

import Link from 'next/link';
import { subscriptionDetailSchema } from '@payscope/shared/records-schemas';
import {
  BackLink,
  DetailField,
  DetailGrid,
  DetailSection,
  SectionEmpty,
  Timestamp,
} from './detail-parts';
import { humanize, recordHref } from './format';
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
              className="underline underline-offset-4"
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
                  className="font-mono text-sm underline underline-offset-4"
                >
                  {entitlement.entitlementKey}
                </Link>
                <StatusBadge status={entitlement.state} />
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
    </div>
  );
}
