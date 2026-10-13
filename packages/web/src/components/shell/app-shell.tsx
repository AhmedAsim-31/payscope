'use client';

import { useEffect, type ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { rememberOrgId } from '@/lib/last-org';
import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';

export function AppShell({
  orgId,
  email,
  children,
}: {
  orgId: string;
  email: string;
  children: ReactNode;
}) {
  useEffect(() => {
    rememberOrgId(orgId);
  }, [orgId]);

  return (
    <SidebarProvider>
      <a
        href="#main-content"
        className="bg-background text-foreground focus-visible:ring-ring sr-only z-50 rounded-md px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:ring-2"
      >
        Skip to content
      </a>
      <AppSidebar orgId={orgId} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader orgId={orgId} email={email} />
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 outline-none sm:p-6">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
