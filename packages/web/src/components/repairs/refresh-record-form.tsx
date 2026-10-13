'use client';

import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api-messages';
import { RepairDialog } from './repair-dialog';
import { useRepair } from './use-repair';

const COPY = {
  payment: {
    label: 'Payment',
    field: 'paymentId',
    description:
      'PayScope reads the payment from the verified provider connection and updates the local status, amount, and currency to match. A matching open status mismatch finding is resolved. Nothing is written to the provider.',
  },
  subscription: {
    label: 'Subscription',
    field: 'subscriptionId',
    description:
      'PayScope reads the subscription from the verified provider connection and updates the local status to match. A matching open status mismatch finding is resolved. Entitlements are not changed. Nothing is written to the provider.',
  },
} as const;

function doneMessage(label: string, resultingState: Record<string, unknown>): string {
  const status = resultingState['status'];
  const resolved = resultingState['resolvedFindingIds'];
  const count = Array.isArray(resolved) ? resolved.length : 0;
  const base = `${label} refreshed: now ${typeof status === 'string' ? status : 'updated'}.`;
  return count > 0 ? `${base} Resolved ${count} finding${count === 1 ? '' : 's'}.` : base;
}

export function RefreshRecordForm({
  orgId,
  kind,
}: {
  orgId: string;
  kind: 'payment' | 'subscription';
}) {
  const copy = COPY[kind];
  const [recordId, setRecordId] = useState('');
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const repair = useRepair(orgId, 'refresh-from-provider');
  const valid = z.uuid().safeParse(recordId.trim()).success;
  const inputId = `refresh-${kind}-id`;

  return (
    <div className="grid max-w-xl gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor={inputId}>{copy.label} id</Label>
        <Input
          id={inputId}
          value={recordId}
          placeholder="00000000-0000-0000-0000-000000000000"
          onChange={(event) => {
            setRecordId(event.target.value);
            setDone(null);
          }}
        />
      </div>
      <div>
        <Button
          disabled={!valid}
          onClick={() => {
            repair.reset();
            setOpen(true);
          }}
        >
          Refresh from provider
        </Button>
      </div>
      {done ? <p className="text-success text-sm">{done}</p> : null}
      {open ? (
        <RepairDialog
          title={`Refresh this ${kind} from the provider?`}
          description={copy.description}
          previous={`Local ${kind} state`}
          resulting={`${copy.label} state reported by the provider`}
          confirmLabel="Refresh from provider"
          isPending={repair.isPending}
          error={repair.isError ? describeError(repair.error, 'repair') : null}
          onCancel={() => setOpen(false)}
          onConfirm={(reason, idempotencyKey) =>
            repair.mutate(
              { body: { [copy.field]: recordId.trim(), reason }, idempotencyKey },
              {
                onSuccess: (result) => {
                  setOpen(false);
                  setDone(doneMessage(copy.label, result.resultingState));
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}
