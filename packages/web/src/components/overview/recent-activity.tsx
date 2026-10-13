import Link from 'next/link';
import type { EventSummary } from '@payscope/shared/events-schemas';
import { formatTimestamp, humanize, recordHref } from '@/components/records/format';
import { StatusBadge } from '@/components/records/status-badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function RecentActivity({ orgId, events }: { orgId: string; events: EventSummary[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent activity</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-muted-foreground text-sm">No events received yet.</p>
        ) : (
          <ul className="divide-y">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2"
              >
                <div className="grid min-w-0 gap-0.5">
                  <Link
                    href={recordHref(orgId, 'events', event.id)}
                    className="truncate text-sm underline-offset-4 hover:underline"
                  >
                    {event.normalizedType ?? event.eventType}
                  </Link>
                  <span className="text-muted-foreground text-xs">
                    {humanize(event.provider)} · {formatTimestamp(event.receivedAt)}
                  </span>
                </div>
                <StatusBadge status={event.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
