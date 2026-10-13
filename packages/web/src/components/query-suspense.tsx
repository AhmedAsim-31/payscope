'use client';

import { Suspense, useSyncExternalStore, type ReactNode } from 'react';

const subscribe = () => () => undefined;

/** Queries need the browser session, so the server renders only the fallback. */
export function QuerySuspense({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return <Suspense fallback={fallback}>{isClient ? children : fallback}</Suspense>;
}
