'use client';

import { useQueryClient } from '@tanstack/react-query';
import { ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

export function RouteError({ error, reset }: { error: Error; reset: () => void }) {
  const queryClient = useQueryClient();
  const requestId = error instanceof ApiClientError ? error.requestId : undefined;

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-start gap-3 py-12">
      <h1 className="text-xl font-semibold">Could not load this page</h1>
      <p className="text-muted-foreground text-sm">
        The request failed. Check your connection and try again.
      </p>
      {requestId ? (
        <p className="text-muted-foreground font-mono text-xs">Request ID: {requestId}</p>
      ) : null}
      <Button
        onClick={() => {
          queryClient.removeQueries();
          reset();
        }}
      >
        Try again
      </Button>
    </div>
  );
}
