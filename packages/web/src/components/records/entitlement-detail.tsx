'use client';

import Link from 'next/link';
import { auditPageSchema } from '@payscope/shared/audit-schemas';
import { findingPageSchema } from '@payscope/shared/reconciliation-schemas';
import { entitlementDetailSchema } from '@payscope/shared/records-schemas';
import { AUDIT_COLUMNS } from '@/components/audit/audit-list';
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
import { RelatedRecords } from './related-records';
import { StatusBadge } from './status-badge';
import { useRecordDetail } from './use-record-detail';

export function EntitlementDetail({
  orgId,
  entitlementId,
}: {
  orgId: string;
  entitlementId: string;
}) {
  const entitlement = useRecordDetail(
    orgId,
    'entitlements',
    entitlementId,
    entitlementDetailSchema,
  );

  return (
    <div className="grid gap-8">
      <div className="grid gap-3">
        <BackLink href={`/app/${orgId}/entitlements`}>Entitlements</BackLink>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold break-all">
            {entitlement.entitlementKey}
          </h1>
          <StatusBadge status={entitlement.state} />
        </div>
      </div>

      <DetailSection title="Details">
        <DetailGrid>
          <DetailField label="Customer">
            <Link
              href={recordHref(orgId, 'customers', entitlement.customer.id)}
              className="underline underline-offset-4"
            >
              {entitlement.customer.email ?? entitlement.customer.id}
            </Link>
          </DetailField>
          <DetailField label="Subscription">
            {entitlement.subscriptionId ? (
              <Link
                href={recordHref(orgId, 'subscriptions', entitlement.subscriptionId)}
                className="underline underline-offset-4"
              >
                View subscription
              </Link>
            ) : (
              <span className="text-muted-foreground">None</span>
            )}
          </DetailField>
          <DetailField label="Source">{humanize(entitlement.source)}</DetailField>
          <DetailField label="Reconciliation">
            {entitlement.reconciliationStatus
              ? humanize(entitlement.reconciliationStatus)
              : 'Not reconciled'}
          </DetailField>
          <DetailField label="Granted">
            <Timestamp value={entitlement.grantedAt} />
          </DetailField>
          <DetailField label="Expires">
            <Timestamp value={entitlement.expiresAt} />
          </DetailField>
          <DetailField label="Revoked">
            <Timestamp value={entitlement.revokedAt} />
          </DetailField>
          <DetailField label="First seen by PayScope">
            <Timestamp value={entitlement.createdAt} />
          </DetailField>
          <DetailField label="Record updated">
            <Timestamp value={entitlement.updatedAt} />
          </DetailField>
        </DetailGrid>
      </DetailSection>

      {entitlement.subscriptionId ? (
        <RelatedRecords
          orgId={orgId}
          title="Subscription findings"
          resource="reconciliation/findings"
          listPath="findings"
          viewAllLabel="View all findings"
          schema={findingPageSchema}
          params={{ subjectType: 'subscription', subjectId: entitlement.subscriptionId }}
          columns={findingColumns(orgId)}
          empty={{
            title: 'No findings',
            hint: 'Reconciliation has not flagged the subscription behind this entitlement.',
          }}
        />
      ) : (
        <DetailSection title="Subscription findings">
          <SectionEmpty>
            Findings are recorded against subscriptions, and this entitlement has none.
          </SectionEmpty>
        </DetailSection>
      )}

      <RelatedRecords
        orgId={orgId}
        title="Audit history"
        resource="audit"
        listPath="audit"
        viewAllLabel="View all audit entries"
        schema={auditPageSchema}
        params={{ targetType: 'entitlement', targetId: entitlement.id }}
        columns={AUDIT_COLUMNS}
        empty={{
          title: 'No audit entries yet',
          hint: 'Audited actions on this entitlement appear here.',
        }}
      />
    </div>
  );
}
