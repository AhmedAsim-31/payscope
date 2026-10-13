import { notFound } from 'next/navigation';
import { z } from 'zod';
import { EventDetail } from '@/components/events/event-detail';
import { PageSkeleton } from '@/components/page-skeleton';
import { QuerySuspense } from '@/components/query-suspense';

export default async function EventPage({
  params,
}: {
  params: Promise<{ orgId: string; eventId: string }>;
}) {
  const { orgId, eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  return (
    <QuerySuspense fallback={<PageSkeleton rows={4} />}>
      <EventDetail orgId={orgId} eventId={eventId} />
    </QuerySuspense>
  );
}
