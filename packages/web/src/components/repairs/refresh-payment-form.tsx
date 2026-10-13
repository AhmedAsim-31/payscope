'use client';

import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api-messages';
import { RepairDialog } from './repair-dialog';
import { useRepair } from './use-repair';

export function RefreshPaymentForm({ orgId }: { orgId: string }) {
  const [paymentId, setPaymentId] = useState('');
  const [open, setOpen] = useState(false);
  const [doneStatus, setDoneStatus] = useState<string | null>(null);
  const repair = useRepair(orgId, 'refresh-from-provider');
  const valid = z.uuid().safeParse(paymentId.trim()).success;

  return (
    <div className="grid max-w-xl gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="refresh-payment-id">Payment id</Label>
        <Input
          id="refresh-payment-id"
          value={paymentId}
          placeholder="00000000-0000-0000-0000-000000000000"
          onChange={(event) => {
            setPaymentId(event.target.value);
            setDoneStatus(null);
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
      {doneStatus ? (
        <p className="text-success text-sm">Payment refreshed: now {doneStatus}.</p>
      ) : null}
      {open ? (
        <RepairDialog
          title="Refresh this payment from the provider?"
          description="PayScope reads the payment from the verified provider connection and updates the local status, amount, and currency to match. Nothing is written to the provider."
          previous="Local payment state"
          resulting="Payment state reported by the provider"
          confirmLabel="Refresh from provider"
          isPending={repair.isPending}
          error={repair.isError ? describeError(repair.error, 'repair') : null}
          onCancel={() => setOpen(false)}
          onConfirm={(reason, idempotencyKey) =>
            repair.mutate(
              { body: { paymentId: paymentId.trim(), reason }, idempotencyKey },
              {
                onSuccess: (result) => {
                  setOpen(false);
                  const status = result.resultingState['status'];
                  setDoneStatus(typeof status === 'string' ? status : 'updated');
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}
