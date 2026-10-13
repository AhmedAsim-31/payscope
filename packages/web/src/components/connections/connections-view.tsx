'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { can } from '@payscope/shared/permissions';
import { PageHeader } from '@/components/page-header';
import { SectionEmpty } from '@/components/records/detail-parts';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { connectionsQueryOptions } from '@/lib/connection-queries';
import { ConnectionCard } from './connection-card';
import { CreateConnectionForm } from './create-connection-form';
import { useConnectionMutations } from './use-connection-mutations';

export function ConnectionsView({ orgId }: { orgId: string }) {
  const org = useCurrentOrg(orgId);
  const { data: connections } = useSuspenseQuery(connectionsQueryOptions(orgId));
  const mutations = useConnectionMutations(orgId);
  const canManage = can(org.role, 'connections:manage');

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Connections"
        description={
          canManage
            ? 'Provider accounts that send webhooks to PayScope. Credentials are encrypted and never shown.'
            : 'Provider accounts that send webhooks to PayScope. Only owners and admins can change connections.'
        }
      />
      {canManage ? <CreateConnectionForm create={mutations.create} /> : null}
      {connections.length === 0 ? (
        <SectionEmpty>No connections yet.</SectionEmpty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              canManage={canManage}
              mutations={mutations}
            />
          ))}
        </div>
      )}
    </div>
  );
}
