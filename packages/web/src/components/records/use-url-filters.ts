'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { toApiParams, type FilterField } from './filter-config';

export function useUrlFilters(fields: readonly FilterField[]) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const apiParams = useMemo(
    () => toApiParams(fields, (name) => searchParams.get(name)),
    [fields, searchParams],
  );

  function navigate(next: URLSearchParams) {
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value) next.set(name, value);
    else next.delete(name);
    navigate(next);
  }

  function clearFilters() {
    const next = new URLSearchParams(searchParams.toString());
    for (const field of fields) next.delete(field.name);
    navigate(next);
  }

  return {
    apiParams,
    read: (name: string) => searchParams.get(name) ?? '',
    isFiltered: fields.some((field) => searchParams.has(field.name)),
    setFilter,
    clearFilters,
  };
}
