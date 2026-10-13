'use client';

import { RouteError } from '@/components/route-error';
import { ApiClientError } from '@/lib/api-client';
import OrgNotFound from './not-found';

export default function OrgError({ error, reset }: { error: Error; reset: () => void }) {
  if (error instanceof ApiClientError && error.status === 404) return <OrgNotFound />;
  return <RouteError error={error} reset={reset} />;
}
