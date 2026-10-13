'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import { orgsQueryOptions } from '@/lib/queries';

export function useCurrentOrg(orgId: string) {
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const org = orgs.find((candidate) => candidate.id === orgId);
  if (!org) notFound();
  return org;
}
