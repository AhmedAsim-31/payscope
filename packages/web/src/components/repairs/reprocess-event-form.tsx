'use client';

import { useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/lib/api-messages';
import { RepairDialog } from './repair-dialog';
import { useRepair } from './use-repair';

export function ReprocessEventForm({ orgId }: { orgId: string }) {
  const [eventId, setEventId] = useState('');
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const repair = useRepair(orgId, 'reprocess-event');
  const valid = z.uuid().safeParse(eventId.trim()).success;

  return (
    <div className="grid max-w-xl gap-3">
      <div className="grid gap-1.5">
        <Label htmlFor="reprocess-event-id">Event id</Label>
        <Input
          id="reprocess-event-id"
          value={eventId}
          placeholder="00000000-0000-0000-0000-000000000000"
          onChange={(event) => {
            setEventId(event.target.value);
            setDone(false);
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
          Reprocess event
        </Button>
      </div>
      {done ? <p className="text-success text-sm">Event re-queued for processing.</p> : null}
      {open ? (
        <RepairDialog
          title="Reprocess this event?"
          description="The stored, signature-verified event is queued again. Guards in the apply step stop a repeat from changing records twice."
          previous="Processed, failed, or needs attention"
          resulting="Pending, job queued"
          confirmLabel="Reprocess event"
          isPending={repair.isPending}
          error={repair.isError ? describeError(repair.error, 'repair') : null}
          onCancel={() => setOpen(false)}
          onConfirm={(reason, idempotencyKey) =>
            repair.mutate(
              { body: { eventId: eventId.trim(), reason }, idempotencyKey },
              {
                onSuccess: () => {
                  setOpen(false);
                  setDone(true);
                },
              },
            )
          }
        />
      ) : null}
    </div>
  );
}
