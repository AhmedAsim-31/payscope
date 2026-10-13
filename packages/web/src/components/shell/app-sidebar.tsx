'use client';

import Link from 'next/link';
import { Sidebar, SidebarContent, SidebarHeader, SidebarRail } from '@/components/ui/sidebar';
import { SidebarNav } from './sidebar-nav';

export function AppSidebar({ orgId }: { orgId: string }) {
  return (
    <Sidebar collapsible="icon" aria-label="Primary">
      <SidebarHeader>
        <Link
          href={`/app/${orgId}`}
          className="focus-visible:ring-sidebar-ring flex h-8 items-center gap-2 rounded-md px-2 font-semibold tracking-tight outline-none focus-visible:ring-2"
        >
          <span
            aria-hidden="true"
            className="bg-sidebar-primary text-sidebar-primary-foreground grid size-6 shrink-0 place-items-center rounded-md text-xs font-bold"
          >
            P
          </span>
          <span className="truncate group-data-[collapsible=icon]:hidden">PayScope</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarNav orgId={orgId} />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
