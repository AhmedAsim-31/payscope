'use client';

import { RouteError } from '@/components/route-error';

export default function AppError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="p-6">
      <RouteError error={error} reset={reset} />
    </main>
  );
}
