'use client';

import { useState } from 'react';
import { DetailField, Timestamp } from '@/components/records/detail-parts';
import { StatusBadge } from '@/components/records/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { describeError } from '@/lib/api-messages';
import {
  CAPABILITY_LABELS,
  CAPABILITY_NAMES,
  PROVIDER_LABELS,
  type Connection,
} from '@/lib/connection-queries';
import { getPublicEnv } from '@/lib/env';
import { EditCredentialsForm } from './edit-credentials-form';
import type { useConnectionMutations } from './use-connection-mutations';

type Props = {
  connection: Connection;
  canManage: boolean;
  mutations: ReturnType<typeof useConnectionMutations>;
};

function CredentialStatus({ isSet }: { isSet: boolean }) {
  return isSet ? <span>Set</span> : <span className="text-muted-foreground">Not set</span>;
}

function testBlocker(connection: Connection): string | null {
  if (connection.mode === 'simulation') return 'Simulated connections have no provider account.';
  if (!connection.hasApiKey) return 'Add a sandbox API key to test credentials.';
  return null;
}

export function ConnectionCard({ connection, canManage, mutations }: Props) {
  const [editing, setEditing] = useState(false);
  const { verify } = mutations;
  const provider = PROVIDER_LABELS[connection.provider];
  const simulated = connection.mode === 'simulation';
  const webhookUrl = `${getPublicEnv().NEXT_PUBLIC_API_URL}${connection.webhookUrl}`;
  const blocker = testBlocker(connection);
  const testing = verify.isPending && verify.variables === connection.id;
  const verifyError =
    verify.isError && verify.variables === connection.id
      ? describeError(verify.error, 'verify-connection')
      : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle>{connection.displayName}</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{simulated ? 'Simulated' : 'Sandbox'}</Badge>
            {simulated ? null : <StatusBadge status={connection.status} />}
          </div>
        </div>
        <CardDescription>
          {simulated
            ? `Simulated ${provider} connection. Events come from seed data and the scenario lab, never from ${provider}.`
            : `${provider} sandbox account ${connection.externalAccountId}.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <DetailField label="Provider">{provider}</DetailField>
          <DetailField label="Last verified">
            {simulated ? (
              <span className="text-muted-foreground">Not applicable</span>
            ) : connection.lastVerifiedAt ? (
              <Timestamp value={connection.lastVerifiedAt} />
            ) : (
              <span className="text-muted-foreground">Never verified</span>
            )}
          </DetailField>
          <DetailField label="API key">
            <CredentialStatus isSet={connection.hasApiKey} />
          </DetailField>
          <DetailField label="Webhook secret">
            <CredentialStatus isSet={connection.hasWebhookSecret} />
          </DetailField>
          <DetailField label="Last error">
            {connection.lastError ?? <span className="text-muted-foreground">None</span>}
          </DetailField>
        </dl>

        <section className="grid gap-2">
          <h3 className="font-medium">Capabilities</h3>
          {simulated ? (
            <p className="text-muted-foreground">
              What the {provider} adapter supports once a sandbox connection is configured.
            </p>
          ) : null}
          <ul className="grid gap-1">
            {Object.entries(connection.capabilities).map(([name, status]) => (
              <li key={name} className="flex justify-between gap-3">
                <span>{CAPABILITY_NAMES[name] ?? name}</span>
                <span className="text-muted-foreground text-right">
                  {CAPABILITY_LABELS[status]}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-2">
          <h3 className="font-medium">Setup</h3>
          {simulated ? (
            <p className="text-muted-foreground">
              No setup needed. PayScope signs these events itself, so nothing is sent to or received
              from {provider}.
            </p>
          ) : (
            <ol className="text-muted-foreground grid list-decimal gap-1 pl-5">
              <li>
                In the {provider} sandbox dashboard, add a webhook endpoint with this URL:
                <code className="bg-muted text-foreground mt-1 block rounded px-2 py-1 break-all select-all">
                  {webhookUrl}
                </code>
              </li>
              <li>Copy the endpoint signing secret into Webhook secret below.</li>
              <li>Add a sandbox API key, then test credentials.</li>
            </ol>
          )}
        </section>

        {canManage ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={blocker !== null || testing}
                onClick={() => verify.mutate(connection.id)}
              >
                {testing ? 'Testing...' : 'Test credentials'}
              </Button>
              {simulated ? null : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  aria-expanded={editing}
                  onClick={() => setEditing((open) => !open)}
                >
                  {editing ? 'Cancel' : 'Edit credentials'}
                </Button>
              )}
              {blocker ? <span className="text-muted-foreground">{blocker}</span> : null}
            </div>
            <p role="alert" className="text-destructive empty:hidden">
              {verifyError}
            </p>
            {editing ? (
              <EditCredentialsForm
                connection={connection}
                update={mutations.update}
                onDone={() => setEditing(false)}
              />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
