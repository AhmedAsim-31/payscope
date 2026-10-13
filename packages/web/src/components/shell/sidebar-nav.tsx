'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { NAV_ITEMS, isNavActive, navHref } from './nav-config';

export function SidebarNav({ orgId }: { orgId: string }) {
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu>
          {NAV_ITEMS.map((item) => {
            const active = isNavActive(pathname, orgId, item);
            return (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                  <Link href={navHref(orgId, item)} aria-current={active ? 'page' : undefined}>
                    <item.icon aria-hidden="true" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
