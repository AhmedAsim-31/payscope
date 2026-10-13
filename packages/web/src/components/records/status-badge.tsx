import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { humanize } from './format';

const SUCCESS = 'border-transparent bg-success-surface text-success';
const WARNING = 'border-transparent bg-warning-surface text-warning';
const DANGER = 'border-transparent bg-danger-surface text-danger';
const INFO = 'border-transparent bg-info-surface text-info';
const NEUTRAL = 'bg-transparent text-muted-foreground';

const TONES: Record<string, string> = {
  succeeded: SUCCESS,
  active: SUCCESS,
  processed: SUCCESS,
  pending: WARNING,
  processing: WARNING,
  queued: WARNING,
  running: INFO,
  dead: DANGER,
  skipped: NEUTRAL,
  past_due: WARNING,
  paused: WARNING,
  partially_refunded: WARNING,
  needs_attention: WARNING,
  failed: DANGER,
  disputed: DANGER,
  revoked: DANGER,
  inconsistent: DANGER,
  trialing: INFO,
  refunded: NEUTRAL,
  canceled: NEUTRAL,
  expired: NEUTRAL,
  duplicate: NEUTRAL,
  ignored: NEUTRAL,
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return <Badge className={cn(TONES[status] ?? NEUTRAL, className)}>{humanize(status)}</Badge>;
}
