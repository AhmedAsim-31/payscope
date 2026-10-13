'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api-messages';
import type { Connection } from '@/lib/connection-queries';
import type { useConnectionMutations } from './use-connection-mutations';

type Props = {
  connection: Connection;
  update: ReturnType<typeof useConnectionMutations>['update'];
  onDone: () => void;
};

export function EditCredentialsForm({ connection, update, onDone }: Props) {
  const [webhookSecret, setWebhookSecret] = useState('');
  const [apiKey, setApiKey] = useState('');
  const isEmpty = webhookSecret.trim() === '' && apiKey.trim() === '';

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending || isEmpty) return;
    update.mutate(
      {
        id: connection.id,
        ...(webhookSecret.trim() ? { webhookSecret: webhookSecret.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      { onSuccess: onDone },
    );
  }

  const secretId = `webhook-secret-${connection.id}`;
  const keyId = `api-key-${connection.id}`;
  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded-lg border p-4"
      aria-busy={update.isPending}
    >
      <p className="text-muted-foreground">
        Values are encrypted on the server and never shown again. Leave a field empty to keep it. A
        new webhook secret is added alongside the previous one so in-flight deliveries still verify.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={secretId}>Webhook secret</Label>
          <Input
            id={secretId}
            type="password"
            autoComplete="off"
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={keyId}>Sandbox API key</Label>
          <Input
            id={keyId}
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={update.isPending || isEmpty}>
          {update.isPending ? 'Saving...' : 'Save credentials'}
        </Button>
      </div>
      <p role="alert" className="text-destructive empty:hidden">
        {update.isError ? describeError(update.error, 'update-connection') : null}
      </p>
    </form>
  );
}
