'use client';

import Link from 'next/link';
import { customerDetailSchema } from '@payscope/shared/records-schemas';
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

export function CustomerDetail({ orgId, customerId }: { orgId: string; customerId: string }) {
  const customer = useRecordDetail(orgId, 'customers', customerId, customerDetailSchema);

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <BackLink href={`/app/${orgId}/customers`}>Customers</BackLink>
        <h1 className="text-xl font-semibold break-all">{customer.email ?? 'No email'}</h1>
      </div>

      <DetailSection title="Details">
        <DetailGrid>
          <DetailField label="Name">{customer.displayName ?? 'Not set'}</DetailField>
          <DetailField label="External reference">{customer.externalRef ?? 'Not set'}</DetailField>
          <DetailField label="First seen by PayScope">
            <Timestamp value={customer.createdAt} />
          </DetailField>
          <DetailField label="Record updated">
            <Timestamp value={customer.updatedAt} />
          </DetailField>
        </DetailGrid>
      </DetailSection>

      <DetailSection title="Provider mappings">
        {customer.mappings.length === 0 ? (
          <SectionEmpty>This customer is not linked to a provider customer id.</SectionEmpty>
        ) : (
          <ul className="grid gap-2">
            {customer.mappings.map((mapping) => (
              <li key={`${mapping.connectionId}-${mapping.providerCustomerId}`} className="text-sm">
                {humanize(mapping.provider)}:{' '}
                <span className="font-mono text-xs break-all">{mapping.providerCustomerId}</span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="Subscriptions">
        {customer.subscriptions.length === 0 ? (
          <SectionEmpty>No subscriptions for this customer.</SectionEmpty>
        ) : (
          <ul className="grid gap-2">
            {customer.subscriptions.map((subscription) => (
              <li key={subscription.id} className="flex flex-wrap items-center gap-2">
                <Link
                  href={recordHref(orgId, 'subscriptions', subscription.id)}
                  className="font-mono text-sm underline underline-offset-4"
                >
                  {subscription.providerSubscriptionId}
                </Link>
                <StatusBadge status={subscription.status} />
              </li>
            ))}
          </ul>
        )}
      </DetailSection>

      <DetailSection title="Entitlements">
        {customer.entitlements.length === 0 ? (
          <SectionEmpty>No entitlements for this customer.</SectionEmpty>
        ) : (
          <ul className="grid gap-2">
            {customer.entitlements.map((entitlement) => (
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
