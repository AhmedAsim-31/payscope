import { describe, expect, it } from 'vitest';
import { ACTIONS, can, type Action, type Role } from './permissions';

const READ: Action[] = [
  'org:read',
  'members:read',
  'connections:read',
  'records:read',
  'events:read',
  'audit:read',
];
const OPERATE: Action[] = [
  'jobs:retry',
  'reconciliation:run',
  'findings:update',
  'repairs:execute',
  'scenarios:run',
  'entitlements:ingest',
];
const ADMIN_ONLY: Action[] = ['org:update', 'members:manage', 'connections:manage'];
const OWNER_ONLY: Action[] = ['org:delete', 'ownership:transfer'];

const allowed: Record<Role, Action[]> = {
  OWNER: [...READ, ...OPERATE, ...ADMIN_ONLY, ...OWNER_ONLY],
  ADMIN: [...READ, ...OPERATE, ...ADMIN_ONLY],
  OPERATOR: [...READ, ...OPERATE],
  VIEWER: READ,
};

describe('can', () => {
  it('covers every action in the expectation table', () => {
    expect([...allowed.OWNER].sort()).toEqual([...ACTIONS].sort());
  });

  const cases = (Object.keys(allowed) as Role[]).flatMap((role) =>
    ACTIONS.map((action) => [role, action, allowed[role].includes(action)] as const),
  );
  it.each(cases)('%s %s -> %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected);
  });
});
