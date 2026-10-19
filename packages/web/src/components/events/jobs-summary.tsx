'use client';

import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { useSuspenseQuery } from '@tanstack/react-query';
import { jobSummarySchema } from '@payscope/shared/events-schemas';
import { formatAge } from '@/components/records/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiFetch } from '@/lib/api-client';

type StatCardProps = {
  title: string;
  value: string;
  hint: string;
  link?: { href: string; label: string };
};

function StatCard({ title, value, hint, link }: StatCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1">
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
        {link ? (
          <Link href={link.href} className="tap-link w-fit text-sm underline underline-offset-4">
            {link.label}
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function JobsSummary({ orgId }: { orgId: string }) {
  const { data } = useSuspenseQuery({
    queryKey: ['orgs', orgId, 'jobs', 'summary'],
    queryFn: async () =>
      jobSummarySchema.parse(await apiFetch(`/api/v1/orgs/${orgId}/jobs/summary`)),
  });
  const { counts, retrying, oldestQueuedAgeSeconds } = data;
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Jobs"
        description="Background work that processes incoming provider events."
      />
      {total === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <h2 className="text-base font-medium">No jobs yet</h2>
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">
            A job is created for every webhook event received through a connection.
          </p>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard title="Queued" value={String(counts.queued)} hint="Waiting for the worker" />
        <StatCard title="Running" value={String(counts.running)} hint="Being processed now" />
        <StatCard
          title="Retrying"
          value={String(retrying)}
          hint="Queued again after a failed attempt"
          link={{ href: `/app/${orgId}/events?status=failed`, label: 'View events awaiting retry' }}
        />
        <StatCard
          title="Dead"
          value={String(counts.dead)}
          hint="Out of attempts, can be retried"
          link={{
            href: `/app/${orgId}/events?status=needs_attention`,
            label: 'View events needing attention',
          }}
        />
        <StatCard
          title="Oldest queued"
          value={oldestQueuedAgeSeconds === null ? 'None' : formatAge(oldestQueuedAgeSeconds)}
          hint={oldestQueuedAgeSeconds === null ? 'Nothing is waiting' : 'Time since it was due'}
        />
      </div>
    </div>
  );
}
