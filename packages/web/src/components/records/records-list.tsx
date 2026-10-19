'use client';

import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { recordsListOptions, type RecordPage, type RecordResource } from '@/lib/records-queries';

const POLL_MS = 2000;

export type Column<T> = {
  header: string;
  cell: (item: T) => ReactNode;
  align?: 'right';
};

export type EmptyCopy = { title: string; filteredTitle: string; hint: string };

type RecordsListProps<T extends { id: string }> = {
  orgId: string;
  resource: RecordResource;
  schema: z.ZodType<RecordPage<T>>;
  params: Readonly<Record<string, string>>;
  columns: readonly Column<T>[];
  caption: string;
  isFiltered: boolean;
  empty: EmptyCopy;
  /** Refetch every few seconds while any loaded item matches. */
  pollWhile?: (item: T) => boolean;
  /** Shows the first page only, linking here instead of loading more. */
  viewAll?: { href: string; label: string };
};

export function RecordsList<T extends { id: string }>({
  orgId,
  resource,
  schema,
  params,
  columns,
  caption,
  isFiltered,
  empty,
  pollWhile,
  viewAll,
}: RecordsListProps<T>) {
  const { data, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } =
    useSuspenseInfiniteQuery({
      ...recordsListOptions(orgId, resource, schema, params),
      refetchInterval: (query) =>
        pollWhile && query.state.data?.pages.some((page) => page.items.some(pollWhile))
          ? POLL_MS
          : false,
    });
  const items = data.pages.flatMap((page) => page.items);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <h2 className="text-base font-medium">{isFiltered ? empty.filteredTitle : empty.title}</h2>
        {isFiltered ? null : (
          <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{empty.hint}</p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader className="max-md:hidden">
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.header}
                scope="col"
                className={cn(column.align === 'right' && 'text-right')}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id} className="max-md:block max-md:py-2">
              {columns.map((column) => (
                <TableCell
                  key={column.header}
                  className={cn(
                    'max-md:flex max-md:items-center max-md:justify-between max-md:gap-4 max-md:py-1 max-md:whitespace-normal',
                    column.align === 'right' && 'md:text-right',
                  )}
                >
                  <span className="text-muted-foreground text-xs md:hidden">{column.header}</span>
                  <span className="max-md:min-w-0 max-md:break-words max-md:text-right">
                    {column.cell(item)}
                  </span>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {isFetchNextPageError ? (
        <p role="alert" className="text-danger text-sm">
          Could not load more. Try again.
        </p>
      ) : null}
      {viewAll && hasNextPage ? (
        <Link href={viewAll.href} className="tap-link w-fit text-sm underline underline-offset-4">
          {viewAll.label}
        </Link>
      ) : hasNextPage ? (
        <div>
          <Button
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => {
              fetchNextPage().catch(() => undefined);
            }}
          >
            {isFetchingNextPage ? 'Loading more' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
