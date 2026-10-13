'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { redirect } from 'next/navigation';
import { readLastOrgId } from '@/lib/last-org';
import { orgsQueryOptions } from '@/lib/queries';

export function OrgRedirect() {
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const lastOrgId = readLastOrgId();
  const target = orgs.find((org) => org.id === lastOrgId) ?? orgs[0];
  return redirect(target ? `/app/${target.id}` : '/app/new');
}
