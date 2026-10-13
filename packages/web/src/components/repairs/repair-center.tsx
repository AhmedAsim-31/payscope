'use client';

import { PageHeader } from '@/components/page-header';
import { Suspense } from 'react';
import { findingPageSchema } from '@payscope/shared/reconciliation-schemas';
import { can } from '@payscope/shared/permissions';
import { DetailSection, SectionEmpty } from '@/components/records/detail-parts';
import { RecordsList } from '@/components/records/records-list';
import { findingColumns } from '@/components/reconciliation/findings-list';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { RefreshPaymentForm } from './refresh-payment-form';
import { ReprocessEventForm } from './reprocess-event-form';

export function RepairCenter({ orgId }: { orgId: string }) {
  const org = useCurrentOrg(orgId);
  const canRepair = can(org.role, 'repairs:execute');

  return (
    <div className="grid gap-8">
      <PageHeader
        title="Repair center"
        description="Repairs change PayScope records only and never write to a provider. Every repair needs a reason and is recorded in the audit log."
      />

      <DetailSection title="Open findings">
        <p className="text-muted-foreground text-sm">
          Open a finding to correct an entitlement or resolve it after verification.
        </p>
        <Suspense fallback={<Skeleton className="h-44 w-full" />}>
          <RecordsList
            orgId={orgId}
            resource="reconciliation/findings"
            schema={findingPageSchema}
            params={{ status: 'open' }}
            columns={findingColumns(orgId)}
            caption="Open findings"
            isFiltered={false}
            empty={{
              title: 'Nothing to repair',
              filteredTitle: 'Nothing to repair',
              hint: 'No open findings. Run reconciliation to check for new inconsistencies.',
            }}
          />
        </Suspense>
      </DetailSection>

      <DetailSection title="Reprocess an event">
        {canRepair ? (
          <ReprocessEventForm orgId={orgId} />
        ) : (
          <SectionEmpty>Your role can view repairs but not run them.</SectionEmpty>
        )}
      </DetailSection>

      <DetailSection title="Refresh a payment from the provider">
        {canRepair ? (
          <RefreshPaymentForm orgId={orgId} />
        ) : (
          <SectionEmpty>Your role can view repairs but not run them.</SectionEmpty>
        )}
      </DetailSection>
    </div>
  );
}
