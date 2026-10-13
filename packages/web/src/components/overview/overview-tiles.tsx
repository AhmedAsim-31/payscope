import Link from 'next/link';
import type { Overview } from '@payscope/shared/overview-schemas';
import { formatAge } from '@/components/records/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarList, barItems } from './bar-list';

function Tile({
  title,
  value,
  hint,
  href,
}: {
  title: string;
  value: string;
  hint: string;
  href?: string;
}) {
  const heading = href ? (
    <Link href={href} className="underline-offset-4 hover:underline">
      {title}
    </Link>
  ) : (
    title
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">{heading}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1">
        <p className="text-3xl font-semibold tabular-nums">{value}</p>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </CardContent>
    </Card>
  );
}

export function SuccessRateTile({ processing }: { processing: Overview['processing'] }) {
  const { successRate, processed, attempted } = processing;
  return (
    <Tile
      title="Processing success rate"
      value={successRate === null ? 'No data' : `${(successRate * 100).toFixed(1)}%`}
      hint={
        successRate === null
          ? 'No events were processed or failed in this range'
          : `${processed} processed of ${attempted} attempted`
      }
    />
  );
}

export function JobsTile({ jobs, orgId }: { jobs: Overview['jobs']; orgId: string }) {
  const oldest = jobs.oldestQueuedAgeSeconds;
  return (
    <Tile
      title="Jobs"
      href={`/app/${orgId}/jobs`}
      value={`${jobs.queued} queued`}
      hint={`${jobs.running} running, ${jobs.dead} dead, oldest queued ${oldest === null ? 'none' : formatAge(oldest)}`}
    />
  );
}

export function FindingsTile({ findings }: { findings: Overview['findings'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">Open findings</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <p className="text-3xl font-semibold tabular-nums">{findings.open}</p>
        <BarList label="Open findings by severity" items={barItems(findings.bySeverity)} />
      </CardContent>
    </Card>
  );
}
