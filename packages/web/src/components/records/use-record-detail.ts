'use client';

import { useSuspenseQuery } from '@tanstack/react-query';
import { notFound } from 'next/navigation';
import type { z } from 'zod';
import { recordDetailOptions, type RecordResource } from '@/lib/records-queries';

export function useRecordDetail<T>(
  orgId: string,
  resource: RecordResource,
  id: string,
  schema: z.ZodType<T>,
): T {
  const { data } = useSuspenseQuery(recordDetailOptions(orgId, resource, id, schema));
  if (data === null) notFound();
  return data;
}
