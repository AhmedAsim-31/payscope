'use client';

import { Suspense } from 'react';
import type { z } from 'zod';
import { Skeleton } from '@/components/ui/skeleton';
import type { RecordPage, RecordResource } from '@/lib/records-queries';
import { DetailSection } from './detail-parts';
import { RecordsList, type Column } from './records-list';

const RELATED_LIMIT = 5;

type RelatedRecordsProps<T extends { id: string }> = {
  orgId: string;
  title: string;
  resource: RecordResource;
  listPath: string;
  viewAllLabel: string;
  schema: z.ZodType<RecordPage<T>>;
  params: Readonly<Record<string, string>>;
  columns: readonly Column<T>[];
  empty: { title: string; hint: string };
};

export function RelatedRecords<T extends { id: string }>({
  orgId,
  title,
  resource,
  listPath,
  viewAllLabel,
  schema,
  params,
  columns,
  empty,
}: RelatedRecordsProps<T>) {
  return (
    <DetailSection title={title}>
      <Suspense fallback={<Skeleton className="h-24 w-full" aria-label={`Loading ${title}`} />}>
        <RecordsList
          orgId={orgId}
          resource={resource}
          schema={schema}
          params={{ ...params, limit: String(RELATED_LIMIT) }}
          columns={columns}
          caption={title}
          isFiltered={false}
          empty={{ ...empty, filteredTitle: empty.title }}
          viewAll={{
            href: `/app/${orgId}/${listPath}?${new URLSearchParams(params).toString()}`,
            label: viewAllLabel,
          }}
        />
      </Suspense>
    </DetailSection>
  );
}
