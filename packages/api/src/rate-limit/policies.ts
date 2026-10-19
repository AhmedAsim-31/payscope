import type { FastifyRequest } from 'fastify';
import { normalizeIP } from '@fastify/rate-limit';
import { z } from 'zod';

export type PolicyScope = 'user' | 'userOrg' | 'org' | 'connection' | 'ip';
export type RatePolicy = { max: number; windowSec: number };

type PolicyDef = RatePolicy & { scope: PolicyScope };

const MINUTE = 60;
const TEN_MINUTES = 600;

export const POLICY_DEFS = {
  authenticatedRead: { max: 300, windowSec: MINUTE, scope: 'user' },
  authenticatedWrite: { max: 60, windowSec: MINUTE, scope: 'user' },
  credentialTest: { max: 5, windowSec: MINUTE, scope: 'userOrg' },
  webhookIngress: { max: 600, windowSec: MINUTE, scope: 'connection' },
  webhookIngressIp: { max: 1200, windowSec: MINUTE, scope: 'ip' },
  internalTick: { max: 30, windowSec: MINUTE, scope: 'ip' },
  reconciliationRun: { max: 5, windowSec: TEN_MINUTES, scope: 'org' },
  scenarioRun: { max: 20, windowSec: TEN_MINUTES, scope: 'org' },
  repairAction: { max: 30, windowSec: TEN_MINUTES, scope: 'userOrg' },
  search: { max: 60, windowSec: MINUTE, scope: 'user' },
} as const satisfies Record<string, PolicyDef>;

export type PolicyName = keyof typeof POLICY_DEFS;
export type RatePolicies = Record<PolicyName, RatePolicy>;

export const POLICY_NAMES = Object.keys(POLICY_DEFS) as PolicyName[];

export const DEFAULT_POLICIES = Object.fromEntries(
  POLICY_NAMES.map((name) => [
    name,
    { max: POLICY_DEFS[name].max, windowSec: POLICY_DEFS[name].windowSec },
  ]),
) as RatePolicies;

export function policyEnvPrefix(name: PolicyName): string {
  return `RATE_LIMIT_${name.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
}

const positiveInt = z.coerce.number().int().min(1).max(1_000_000);
const windowSeconds = z.coerce.number().int().min(1).max(86_400);

export const rateLimitEnvSchema = z.object(
  Object.fromEntries(
    POLICY_NAMES.flatMap((name) => [
      [`${policyEnvPrefix(name)}_MAX`, positiveInt.optional()],
      [`${policyEnvPrefix(name)}_WINDOW_SEC`, windowSeconds.optional()],
    ]),
  ),
);

export function resolvePolicies(overrides: Record<string, number | undefined>): RatePolicies {
  const resolved = { ...DEFAULT_POLICIES };
  for (const name of POLICY_NAMES) {
    const prefix = policyEnvPrefix(name);
    resolved[name] = {
      max: overrides[`${prefix}_MAX`] ?? DEFAULT_POLICIES[name].max,
      windowSec: overrides[`${prefix}_WINDOW_SEC`] ?? DEFAULT_POLICIES[name].windowSec,
    };
  }
  return resolved;
}

const connectionParams = z.object({ connectionId: z.uuid() });

export function rateLimitKey(name: PolicyName, request: FastifyRequest): string {
  const userId = request.auth?.userId;
  const orgId = request.org?.id;
  const byIp = () => `${name}:ip:${normalizeIP(request.ip)}`;
  switch (POLICY_DEFS[name].scope) {
    case 'user':
      return userId ? `${name}:user:${userId}` : byIp();
    case 'userOrg':
      return userId && orgId ? `${name}:user:${userId}:org:${orgId}` : byIp();
    case 'org':
      return orgId ? `${name}:org:${orgId}` : byIp();
    case 'connection': {
      const params = connectionParams.safeParse(request.params);
      return params.success ? `${name}:connection:${params.data.connectionId}` : byIp();
    }
    case 'ip':
      return byIp();
  }
}
