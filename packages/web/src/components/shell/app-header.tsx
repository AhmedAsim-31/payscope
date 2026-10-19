import { QuerySuspense } from '@/components/query-suspense';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { OrgSwitcher } from './org-switcher';
import { SignOutForm } from './sign-out-form';

export function AppHeader({ orgId, email }: { orgId: string; email: string }) {
  return (
    <header className="bg-background sticky top-0 z-10 shrink-0 border-b">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <SidebarTrigger aria-label="Toggle navigation" />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <QuerySuspense fallback={<Skeleton className="h-9 w-40" />}>
          <OrgSwitcher orgId={orgId} />
        </QuerySuspense>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Badge
            variant="outline"
            className="border-warning/40 bg-warning-surface text-warning hidden sm:inline-flex"
          >
            Sandbox · fictional data
          </Badge>
          <span className="text-muted-foreground hidden max-w-48 truncate text-sm md:inline">
            {email}
          </span>
          <SignOutForm />
        </div>
      </div>
      <p className="border-warning/40 bg-warning-surface text-warning border-t py-1 text-center text-xs sm:hidden">
        Sandbox · fictional data
      </p>
    </header>
  );
}
