'use client';

import { useState, type SubmitEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api-messages';
import {
  CONNECTION_PROVIDERS,
  PROVIDER_LABELS,
  type ConnectionProvider,
} from '@/lib/connection-queries';
import type { useConnectionMutations } from './use-connection-mutations';

const selectClass =
  'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]';

export function CreateConnectionForm({
  create,
}: {
  create: ReturnType<typeof useConnectionMutations>['create'];
}) {
  const [provider, setProvider] = useState<ConnectionProvider>('stripe');
  const [mode, setMode] = useState<'sandbox' | 'simulation'>('sandbox');
  const [displayName, setDisplayName] = useState('');
  const [externalAccountId, setExternalAccountId] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [apiKey, setApiKey] = useState('');

  function reset() {
    setDisplayName('');
    setExternalAccountId('');
    setWebhookSecret('');
    setApiKey('');
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    create.mutate(
      {
        provider,
        mode,
        displayName: displayName.trim(),
        externalAccountId: externalAccountId.trim(),
        ...(webhookSecret.trim() ? { webhookSecrets: [webhookSecret.trim()] } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      },
      { onSuccess: reset },
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid gap-3 rounded-lg border p-4"
      aria-busy={create.isPending}
    >
      <h2 className="text-sm font-semibold">Add a connection</h2>
      <p className="text-muted-foreground text-sm">
        Sandbox keys only. Live keys are rejected. A new connection stays unverified until its
        credentials pass a test.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="connection-provider">Provider</Label>
          <select
            id="connection-provider"
            className={selectClass}
            value={provider}
            onChange={(event) => {
              const next = CONNECTION_PROVIDERS.find((p) => p === event.target.value);
              if (next) setProvider(next);
            }}
          >
            {CONNECTION_PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="connection-mode">Mode</Label>
          <select
            id="connection-mode"
            className={selectClass}
            value={mode}
            onChange={(event) =>
              setMode(event.target.value === 'simulation' ? 'simulation' : 'sandbox')
            }
          >
            <option value="sandbox">Sandbox</option>
            <option value="simulation">Simulated</option>
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="connection-name">Display name</Label>
          <Input
            id="connection-name"
            required
            maxLength={100}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="connection-account">Provider account ID</Label>
          <Input
            id="connection-account"
            required
            maxLength={200}
            autoComplete="off"
            value={externalAccountId}
            onChange={(event) => setExternalAccountId(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="connection-webhook-secret">Webhook secret (optional)</Label>
          <Input
            id="connection-webhook-secret"
            type="password"
            autoComplete="off"
            value={webhookSecret}
            onChange={(event) => setWebhookSecret(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="connection-api-key">Sandbox API key (optional)</Label>
          <Input
            id="connection-api-key"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </div>
      </div>
      <div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Adding...' : 'Add connection'}
        </Button>
      </div>
      <p role="alert" className="text-destructive text-sm empty:hidden">
        {create.isError ? describeError(create.error, 'create-connection') : null}
      </p>
    </form>
  );
}
