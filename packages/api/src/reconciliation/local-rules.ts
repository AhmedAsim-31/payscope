import { sql, type SQL } from 'drizzle-orm';
import type { FINDING_SEVERITIES, FINDING_TYPES } from '@payscope/shared/reconciliation-schemas';
import type { Db } from '../db/client';
import type { FindingDraft } from './finding-upsert';

export type RuleParams = {
  orgId: string;
  connectionId: string | null;
  after: string | null;
  limit: number;
};

export type Candidate = { cursor: string; draft: FindingDraft };

export type LocalRule = {
  phase: string;
  find(db: Db, params: RuleParams): Promise<Candidate[]>;
};

type Row = { cursor: string; subjectId: string; key?: string } & Record<string, unknown>;
type Spec = {
  phase: string;
  type: (typeof FINDING_TYPES)[number];
  severity: (typeof FINDING_SEVERITIES)[number];
  subjectType: string;
  recommendedAction: string;
  query: (p: RuleParams) => SQL;
};

const connFilter = (col: SQL, p: RuleParams) =>
  sql`(${p.connectionId}::uuid is null or ${col} = ${p.connectionId}::uuid)`;
const afterFilter = (col: SQL, p: RuleParams) =>
  sql`(${p.after}::uuid is null or ${col} > ${p.after}::uuid)`;

function rule(spec: Spec): LocalRule {
  return {
    phase: spec.phase,
    async find(db, params) {
      const rows = await db.execute<Row>(spec.query(params));
      return [...rows].map(({ cursor, subjectId, key, ...evidence }) => ({
        cursor,
        draft: {
          type: spec.type,
          severity: spec.severity,
          subjectType: spec.subjectType,
          subjectId,
          key,
          recommendedAction: spec.recommendedAction,
          evidence,
        },
      }));
    },
  };
}

const entitlementMissing = rule({
  phase: 'entitlement_missing_or_stale',
  type: 'entitlement_missing_or_stale',
  severity: 'high',
  subjectType: 'customer',
  recommendedAction:
    'Grant the entitlement for the active subscription, or verify why the payment did not produce one.',
  query: (p) => sql`
    select c.id::text as "cursor", c.id::text as "subjectId",
      (select pr.id::text from payment_records pr
        where pr.org_id = c.org_id and pr.customer_id = c.id and pr.status = 'succeeded'
          and ${connFilter(sql`pr.connection_id`, p)}
        order by pr.created_at desc, pr.id desc limit 1) as "paymentId",
      (select s.id::text from subscription_records s
        where s.org_id = c.org_id and s.customer_id = c.id and s.status in ('active', 'trialing')
          and ${connFilter(sql`s.connection_id`, p)}
        order by s.created_at desc, s.id desc limit 1) as "subscriptionId"
    from customers c
    where c.org_id = ${p.orgId}::uuid and ${afterFilter(sql`c.id`, p)}
      and exists (select 1 from payment_records pr
        where pr.org_id = c.org_id and pr.customer_id = c.id and pr.status = 'succeeded'
          and ${connFilter(sql`pr.connection_id`, p)})
      and exists (select 1 from subscription_records s
        where s.org_id = c.org_id and s.customer_id = c.id and s.status in ('active', 'trialing')
          and ${connFilter(sql`s.connection_id`, p)})
      and not exists (select 1 from entitlement_records e
        where e.org_id = c.org_id and e.customer_id = c.id and e.state = 'active')
    order by c.id limit ${p.limit}::int`,
});

const expiredButActive = rule({
  phase: 'expired_externally_active_locally',
  type: 'expired_externally_active_locally',
  severity: 'high',
  subjectType: 'subscription',
  recommendedAction: 'Expire the entitlement; the subscription period has ended.',
  query: (p) => sql`
    select e.id::text as "cursor", s.id::text as "subjectId", e.entitlement_key as "key",
      e.id::text as "entitlementId", s.status::text as "subscriptionStatus",
      s.current_period_end::text as "periodEnd"
    from entitlement_records e
    join subscription_records s on s.org_id = e.org_id and s.id = e.subscription_id
    where e.org_id = ${p.orgId}::uuid and e.state = 'active'
      and ${connFilter(sql`s.connection_id`, p)} and ${afterFilter(sql`e.id`, p)}
      and ((s.status = 'expired' and (s.current_period_end is null or s.current_period_end < now()))
        or (s.status = 'canceled' and s.current_period_end < now()))
    order by e.id limit ${p.limit}::int`,
});

const refundInconsistent = rule({
  phase: 'refund_inconsistent',
  type: 'refund_inconsistent',
  severity: 'medium',
  subjectType: 'payment',
  recommendedAction: 'Compare the payment status with its refunded amount against the provider.',
  query: (p) => sql`
    select pr.id::text as "cursor", pr.id::text as "subjectId", pr.status::text as status,
      pr.amount_minor::text as "amountMinor", pr.amount_refunded_minor::text as "amountRefundedMinor"
    from payment_records pr
    where pr.org_id = ${p.orgId}::uuid and ${connFilter(sql`pr.connection_id`, p)}
      and ${afterFilter(sql`pr.id`, p)}
      and ((pr.amount_refunded_minor > 0 and pr.status not in ('refunded', 'partially_refunded'))
        or (pr.status = 'refunded' and pr.amount_refunded_minor = 0))
    order by pr.id limit ${p.limit}::int`,
});

function mappingRule(table: 'payment_records' | 'subscription_records', subjectType: string) {
  const t = sql.raw(table);
  return rule({
    phase: `mapping_${subjectType}`,
    type: 'mapping_missing_or_ambiguous',
    severity: 'medium',
    subjectType,
    recommendedAction: 'Link the customer to exactly one provider customer id for this connection.',
    query: (p) => sql`
      select r.id::text as "cursor", r.id::text as "subjectId", r.customer_id::text as "customerId",
        (select count(*) from provider_customer_mappings m
          where m.org_id = r.org_id and m.connection_id = r.connection_id
            and m.customer_id = r.customer_id)::int as "mappingCount"
      from ${t} r
      where r.org_id = ${p.orgId}::uuid and r.customer_id is not null
        and ${connFilter(sql`r.connection_id`, p)} and ${afterFilter(sql`r.id`, p)}
        and (select count(*) from provider_customer_mappings m
          where m.org_id = r.org_id and m.connection_id = r.connection_id
            and m.customer_id = r.customer_id) <> 1
      order by r.id limit ${p.limit}::int`,
  });
}

const EXPECTED: Record<'payment' | 'subscription', Record<string, readonly string[]>> = {
  payment: {
    'payment.succeeded': ['succeeded', 'refunded', 'partially_refunded', 'disputed'],
    'payment.failed': ['failed'],
    'payment.refunded': ['refunded', 'partially_refunded'],
    'payment.disputed': ['disputed'],
  },
  subscription: {
    'subscription.created': ['active', 'trialing'],
    'subscription.renewed': ['active', 'trialing'],
    'subscription.canceled': ['canceled', 'expired'],
    'subscription.expired': ['expired'],
  },
};

function expectedValues(kind: keyof typeof EXPECTED): SQL {
  const rows = Object.entries(EXPECTED[kind]).map(
    ([eventType, statuses]) =>
      sql`(${eventType}::text, ${sql.raw(`array['${statuses.join("','")}']::text[]`)})`,
  );
  return sql.join(rows, sql`, `);
}

function stuckEventRule(kind: keyof typeof EXPECTED) {
  const table = sql.raw(kind === 'payment' ? 'payment_records' : 'subscription_records');
  const idCol = sql.raw(kind === 'payment' ? 'provider_payment_id' : 'provider_subscription_id');
  return rule({
    phase: `stuck_event_${kind}`,
    type: 'status_mismatch',
    severity: 'medium',
    subjectType: kind,
    recommendedAction:
      'Retry or inspect the stuck event, then verify the record status against the provider.',
    query: (p) => sql`
      select e.id::text as "cursor", r.id::text as "subjectId", e.id::text as "eventId",
        e.normalized_type as "eventType", r.status::text as "recordStatus"
      from provider_events e
      join ${table} r on r.org_id = e.org_id and r.connection_id = e.connection_id
        and r.${idCol} = e.object_ref
      join (values ${expectedValues(kind)}) as m(event_type, ok) on m.event_type = e.normalized_type
      where e.org_id = ${p.orgId}::uuid and e.status = 'needs_attention'
        and ${connFilter(sql`e.connection_id`, p)} and ${afterFilter(sql`e.id`, p)}
        and not (r.status::text = any(m.ok))
      order by e.id limit ${p.limit}::int`,
  });
}

export const LOCAL_RULES: readonly LocalRule[] = [
  entitlementMissing,
  expiredButActive,
  refundInconsistent,
  mappingRule('payment_records', 'payment'),
  mappingRule('subscription_records', 'subscription'),
  stuckEventRule('payment'),
  stuckEventRule('subscription'),
];
