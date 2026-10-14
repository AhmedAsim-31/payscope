'use client';

import { PageHeader } from '@/components/page-header';
import { useSuspenseQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { OVERVIEW_RANGES, type OverviewRange } from '@payscope/shared/overview-schemas';
import { QuerySuspense } from '@/components/query-suspense';
import { RoleBadge } from '@/components/role-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentOrg } from '@/hooks/use-current-org';
import { overviewQueryOptions } from '@/lib/overview-queries';
import { cn } from '@/lib/utils';
import { BarList, barItems } from './bar-list';
import { CurrencyCard } from './currency-card';
import { FindingsTile, IncidentsTile, JobsTile, SuccessRateTile } from './overview-tiles';
import { RecentActivity } from './recent-activity';

const DEFAULT_RANGE: OverviewRange = '30d';

function parseRange(value: string | null): OverviewRange {
  return OVERVIEW_RANGES.find((range) => range === value) ?? DEFAULT_RANGE;
}

function RangeControl({ orgId, active }: { orgId: string; active: OverviewRange }) {
  return (
    <nav aria-label="Date range" className="inline-flex rounded-md border p-0.5">
      {OVERVIEW_RANGES.map((range) => (
        <Link
          key={range}
          href={`/app/${orgId}?range=${range}`}
          replace
          aria-current={range === active ? 'true' : undefined}
          className={cn(
            'rounded px-3 py-1 text-sm',
            range === active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
          )}
        >
          {range}
        </Link>
      ))}
    </nav>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function OverviewData({ orgId, range }: { orgId: string; range: OverviewRange }) {
  const { data } = useSuspenseQuery(overviewQueryOptions(orgId, range));
  const isEmpty =
    data.payments.length === 0 &&
    Object.values(data.events).every((n) => n === 0) &&
    Object.values(data.subscriptions).every((n) => n === 0) &&
    Object.values(data.entitlements).every((n) => n === 0);

  if (isEmpty) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="text-base font-medium">No activity yet</h2>
        <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
          Nothing was recorded in the last {range}. Metrics appear once a connected provider
          delivers webhook events, or when seed data is loaded.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <section aria-labelledby="payments-heading" className="grid gap-3">
        <h2 id="payments-heading" className="text-lg font-medium">
          Payments by currency
        </h2>
        {data.payments.length === 0 ? (
          <p className="text-muted-foreground text-sm">No payments in this range.</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.payments.map((entry) => (
              <CurrencyCard key={entry.currency} data={entry} />
            ))}
          </div>
        )}
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SuccessRateTile processing={data.processing} />
        <JobsTile jobs={data.jobs} orgId={orgId} />
        <IncidentsTile incidents={data.incidents} orgId={orgId} />
        <FindingsTile findings={data.findings} />
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SectionCard title="Subscriptions">
          <BarList label="Subscriptions by status" items={barItems(data.subscriptions)} />
        </SectionCard>
        <SectionCard title="Entitlements">
          <BarList label="Entitlements by state" items={barItems(data.entitlements)} />
        </SectionCard>
        <SectionCard title="Events in range">
          <BarList label="Events by status" items={barItems(data.events)} />
        </SectionCard>
      </div>
      <RecentActivity orgId={orgId} events={data.recentEvents} />
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading overview">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
        <Skeleton className="h-52" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export function OverviewView({ orgId }: { orgId: string }) {
  const org = useCurrentOrg(orgId);
  const range = parseRange(useSearchParams().get('range'));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={org.name}
        badge={<RoleBadge role={org.role} />}
        actions={<RangeControl orgId={org.id} active={range} />}
      />
      <QuerySuspense fallback={<OverviewSkeleton />}>
        <OverviewData orgId={org.id} range={range} />
      </QuerySuspense>
    </div>
  );
}
