'use client';

import { PageHeader } from '@/components/page-header';
import { Suspense } from 'react';
import type { z } from 'zod';
import { Skeleton } from '@/components/ui/skeleton';
import type { RecordPage, RecordResource } from '@/lib/records-queries';
import { ExportCsvButton } from './export-csv-button';
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
  exportable?: boolean;
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
  exportable = false,
}: RecordsListViewProps<T>) {
  const filters = useUrlFilters(fields);

  return (
    <div className="grid gap-6">
      <PageHeader
        title={title}
        description={description}
        actions={
          exportable ? (
            <ExportCsvButton orgId={orgId} resource={resource} params={filters.apiParams} />
          ) : null
        }
      />
      <FilterBar
        label={`Filter ${title.toLowerCase()}`}
        fields={fields}
        read={filters.read}
        isFiltered={filters.isFiltered}
        onChange={filters.setFilter}
        onApply={filters.setFilters}
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
