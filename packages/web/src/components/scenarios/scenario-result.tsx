import Link from 'next/link';
import { Check, X } from 'lucide-react';
import type { ScenarioEvidence, ScenarioRun } from '@payscope/shared/scenario-schemas';
import { StatusBadge } from '@/components/records/status-badge';

type Group = {
  key: keyof Pick<
    ScenarioEvidence,
    | 'eventIds'
    | 'findingIds'
    | 'paymentIds'
    | 'subscriptionIds'
    | 'entitlementIds'
    | 'jobIds'
    | 'runIds'
  >;
  label: string;
  href: (orgId: string, id: string) => string;
};

const GROUPS: readonly Group[] = [
  { key: 'eventIds', label: 'Events', href: (o, id) => `/app/${o}/events/${id}` },
  { key: 'paymentIds', label: 'Payments', href: (o, id) => `/app/${o}/payments/${id}` },
  {
    key: 'subscriptionIds',
    label: 'Subscriptions',
    href: (o, id) => `/app/${o}/subscriptions/${id}`,
  },
  {
    key: 'entitlementIds',
    label: 'Entitlements',
    href: (o, id) => `/app/${o}/entitlements/${id}`,
  },
  { key: 'findingIds', label: 'Findings', href: (o, id) => `/app/${o}/findings/${id}` },
  { key: 'runIds', label: 'Reconciliation runs', href: (o) => `/app/${o}/reconciliation` },
  { key: 'jobIds', label: 'Jobs', href: (o) => `/app/${o}/jobs` },
];

export function ScenarioResult({ orgId, run }: { orgId: string; run: ScenarioRun }) {
  if (run.status === 'running') {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        Running through the real pipeline...
      </p>
    );
  }
  const evidence = run.result?.evidence;
  return (
    <div className="grid gap-3 text-sm" aria-label="Scenario result">
      <div className="flex items-center gap-2">
        <StatusBadge status={run.status} />
        <span className="text-muted-foreground">
          {run.status === 'passed'
            ? 'The expected outcome was observed.'
            : 'The expected outcome was not observed.'}
        </span>
      </div>
      {run.error ? <p className="text-destructive">{run.error}</p> : null}
      <ul className="grid gap-1">
        {run.result?.checks.map((check) => (
          <li key={check.label} className="flex items-start gap-2">
            {check.passed ? (
              <Check className="text-success mt-0.5 size-4 shrink-0" aria-label="Passed" />
            ) : (
              <X className="text-danger mt-0.5 size-4 shrink-0" aria-label="Failed" />
            )}
            <span>
              {check.label}
              {check.passed || !check.detail ? null : (
                <span className="text-muted-foreground"> ({check.detail})</span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {evidence ? (
        <div className="grid gap-1">
          <p className="font-medium">Evidence</p>
          {evidence.http.map((h, i) => (
            <p key={`${i}-${h.request}`} className="text-muted-foreground font-mono text-xs">
              {h.request} returned {h.status}
              {h.code ? ` ${h.code}` : ''}
            </p>
          ))}
          {evidence.notes.map((note) => (
            <p key={note} className="text-muted-foreground text-xs">
              {note}
            </p>
          ))}
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {GROUPS.filter((g) => evidence[g.key].length > 0).map((g) => (
              <li key={g.key}>
                {g.label}:{' '}
                {evidence[g.key].slice(0, 3).map((id, index) => (
                  <Link
                    key={id}
                    className="underline"
                    href={g.href(orgId, id)}
                    aria-label={`${g.label} ${index + 1}`}
                  >
                    {index + 1}{' '}
                  </Link>
                ))}
                {evidence[g.key].length > 3 ? `(+${evidence[g.key].length - 3} more)` : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
