'use client';

import { ArrowRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  REPAIR_REASON_MAX,
  REPAIR_REASON_MIN,
  reasonSchema,
} from '@payscope/shared/repair-schemas';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

type RepairDialogProps = {
  title: string;
  description: ReactNode;
  previous: string;
  resulting: string;
  confirmLabel: string;
  isPending: boolean;
  error: string | null;
  onConfirm: (reason: string, idempotencyKey: string) => void;
  onCancel: () => void;
};

/** Mount only while open: each mount draws a fresh idempotency key, so a retry in the same dialog replays and a new dialog starts clean. */
export function RepairDialog({
  title,
  description,
  previous,
  resulting,
  confirmLabel,
  isPending,
  error,
  onConfirm,
  onCancel,
}: RepairDialogProps) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const parsed = reasonSchema.safeParse(reason);
  const invalid = touched && !parsed.success;

  return (
    <Dialog open onOpenChange={(next) => (next || isPending ? undefined : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div
          className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
          aria-label="State change"
        >
          <span className="text-muted-foreground">Previous</span>
          <span className="font-medium">{previous}</span>
          <ArrowRight className="text-muted-foreground size-4" aria-hidden="true" />
          <span className="text-muted-foreground">Resulting</span>
          <span className="font-medium">{resulting}</span>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="repair-reason">Reason</Label>
          <textarea
            id="repair-reason"
            value={reason}
            rows={3}
            maxLength={REPAIR_REASON_MAX}
            aria-invalid={invalid}
            aria-describedby="repair-reason-hint"
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
            className="border-input focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] aria-invalid:border-destructive"
          />
          <p
            id="repair-reason-hint"
            className={invalid ? 'text-destructive text-xs' : 'text-muted-foreground text-xs'}
          >
            {REPAIR_REASON_MIN} to {REPAIR_REASON_MAX} characters. Recorded in the audit log.
          </p>
        </div>
        <p role="alert" className="text-destructive text-sm empty:hidden">
          {error}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => parsed.success && onConfirm(parsed.data, idempotencyKey)}
            disabled={!parsed.success || isPending}
            aria-busy={isPending}
          >
            {isPending ? 'Working...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
