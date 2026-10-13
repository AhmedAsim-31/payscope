'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import Link from 'next/link';
import { RoleBadge } from '@/components/role-badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { orgsQueryOptions } from '@/lib/queries';

export function OrgSwitcher({ orgId }: { orgId: string }) {
  const { data: orgs } = useSuspenseQuery(orgsQueryOptions);
  const current = orgs.find((org) => org.id === orgId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="max-w-36 justify-between sm:max-w-56"
          aria-label="Switch organization"
        >
          <span className="truncate">{current?.name ?? 'Select organization'}</span>
          <ChevronsUpDown aria-hidden="true" className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {orgs.map((org) => (
          <DropdownMenuItem key={org.id} asChild>
            <Link
              href={`/app/${org.id}`}
              aria-current={org.id === orgId ? 'true' : undefined}
              className="justify-between gap-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Check
                  aria-hidden="true"
                  className={org.id === orgId ? 'size-4' : 'size-4 opacity-0'}
                />
                <span className="truncate">{org.name}</span>
              </span>
              <RoleBadge role={org.role} />
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/new">
            <Plus aria-hidden="true" />
            Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
