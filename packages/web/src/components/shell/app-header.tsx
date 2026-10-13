import { QuerySuspense } from '@/components/query-suspense';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { OrgSwitcher } from './org-switcher';
import { SignOutForm } from './sign-out-form';

export function AppHeader({ orgId, email }: { orgId: string; email: string }) {
  return (
    <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-3 sm:px-4">
      <SidebarTrigger aria-label="Toggle navigation" />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <QuerySuspense fallback={<Skeleton className="h-9 w-40" />}>
        <OrgSwitcher orgId={orgId} />
      </QuerySuspense>
      <div className="ml-auto flex items-center gap-2">
        <Badge variant="outline" className="border-warning/40 bg-warning-surface text-warning">
          <span className="sm:hidden">Sandbox</span>
          <span className="hidden sm:inline">Sandbox · fictional data</span>
        </Badge>
        <span className="text-muted-foreground hidden max-w-48 truncate text-sm md:inline">
          {email}
        </span>
        <SignOutForm />
      </div>
    </header>
  );
}
