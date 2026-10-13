'use client';

import { Suspense } from 'react';
import type { z } from 'zod';
import { Skeleton } from '@/components/ui/skeleton';
import type { RecordPage, RecordResource } from '@/lib/records-queries';
import { FilterBar } from './filter-bar';
import type { FilterField } from './filter-config';
import { RecordsList, type Column, type EmptyCopy } from './records-list';
import { useUrlFilters } from './use-url-filters';

type RecordsListViewProps<T extends { id: string }> = {
  orgId: string;
  resource: RecordResource;
  title: string;
  description: string;
  fields: readonly FilterField[];
  schema: z.ZodType<RecordPage<T>>;
  columns: readonly Column<T>[];
  empty: EmptyCopy;
};

function ListSkeleton() {
  return (
    <div className="grid gap-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function RecordsListView<T extends { id: string }>({
  orgId,
  resource,
  title,
  description,
  fields,
  schema,
  columns,
  empty,
}: RecordsListViewProps<T>) {
  const filters = useUrlFilters(fields);

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <FilterBar
        label={`Filter ${title.toLowerCase()}`}
        fields={fields}
        read={filters.read}
        isFiltered={filters.isFiltered}
        onChange={filters.setFilter}
        onClear={filters.clearFilters}
      />
      <Suspense fallback={<ListSkeleton />}>
        <RecordsList
          orgId={orgId}
          resource={resource}
          schema={schema}
          params={filters.apiParams}
          columns={columns}
          caption={title}
          isFiltered={filters.isFiltered}
          empty={empty}
        />
      </Suspense>
    </div>
  );
}
