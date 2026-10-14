export const ROLES = ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  'org:read',
  'org:update',
  'org:delete',
  'members:read',
  'members:manage',
  'ownership:transfer',
  'connections:read',
  'connections:manage',
  'records:read',
  'records:export',
  'events:read',
  'jobs:retry',
  'reconciliation:run',
  'findings:update',
  'repairs:execute',
  'scenarios:run',
  'entitlements:ingest',
  'audit:read',
] as const;
export type Action = (typeof ACTIONS)[number];

const READ_ACTIONS: readonly Action[] = [
  'org:read',
  'members:read',
  'connections:read',
  'records:read',
  'events:read',
  'audit:read',
];

const OPERATOR_ACTIONS: readonly Action[] = [
  ...READ_ACTIONS,
  'jobs:retry',
  'reconciliation:run',
  'findings:update',
  'repairs:execute',
  'scenarios:run',
  'entitlements:ingest',
  'records:export',
];

const PERMISSIONS: Record<Role, ReadonlySet<Action>> = {
  OWNER: new Set(ACTIONS),
  ADMIN: new Set(ACTIONS.filter((a) => a !== 'org:delete' && a !== 'ownership:transfer')),
  OPERATOR: new Set(OPERATOR_ACTIONS),
  VIEWER: new Set(READ_ACTIONS),
};

export function can(role: Role, action: Action): boolean {
  return PERMISSIONS[role].has(action);
}
