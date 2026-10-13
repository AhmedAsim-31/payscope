import type { EventAttempt } from '@payscope/shared/events-schemas';
import { SectionEmpty, Timestamp } from '@/components/records/detail-parts';
import { formatDuration, humanize } from '@/components/records/format';
import { StatusBadge } from '@/components/records/status-badge';

export function AttemptsTimeline({ attempts }: { attempts: EventAttempt[] }) {
  if (attempts.length === 0) {
    return (
      <SectionEmpty>
        No processing attempts yet. An attempt is recorded each time the worker picks this event up.
      </SectionEmpty>
    );
  }
  return (
    <ol className="grid gap-4 border-l pl-4">
      {attempts.map((attempt) => (
        <li key={attempt.id} className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Attempt {attempt.attemptNumber}</span>
            {attempt.outcome ? (
              <StatusBadge status={attempt.outcome} />
            ) : (
              <span className="text-muted-foreground text-xs">In progress</span>
            )}
            {attempt.failureCategory ? (
              <span className="text-muted-foreground text-xs">
                {humanize(attempt.failureCategory)}
                {attempt.retryable === null
                  ? ''
                  : attempt.retryable
                    ? ', retryable'
                    : ', not retryable'}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            Started <Timestamp value={attempt.startedAt} />
            {attempt.durationMs === null ? '' : `, took ${formatDuration(attempt.durationMs)}`}
          </p>
          {attempt.errorMessage ? (
            <p className="font-mono text-xs break-words">{attempt.errorMessage}</p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
