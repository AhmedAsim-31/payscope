'use client';

import Link from 'next/link';
import { RoleBadge } from '@/components/role-badge';
import { Button } from '@/components/ui/button';
import { useCurrentOrg } from '@/hooks/use-current-org';

export function OverviewView({ orgId }: { orgId: string }) {
  const org = useCurrentOrg(orgId);

  return (
    <div className="grid max-w-2xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{org.name}</h1>
        <RoleBadge role={org.role} />
      </div>
      <p className="text-muted-foreground text-sm">
        The dashboard arrives with records ingestion. Until then there is nothing to measure, so
        this page shows no metrics.
      </p>
      <div>
        <Button asChild variant="outline">
          <Link href={`/app/${org.id}/members`}>View members</Link>
        </Button>
      </div>
    </div>
  );
}
