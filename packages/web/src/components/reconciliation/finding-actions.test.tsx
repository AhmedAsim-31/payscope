import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Role } from '@payscope/shared/permissions';
import { renderWithQuery } from '@/test/render';
import { FindingActions } from './finding-actions';

const ID = '11111111-1111-4111-8111-111111111111';
const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';

function renderActions(
  role: Role,
  type: Parameters<typeof FindingActions>[0]['type'],
  status = 'open',
) {
  renderWithQuery(
    <FindingActions orgId={ORG} findingId={ID} type={type} status={status} role={role} />,
  );
}

const has = (name: string) => screen.queryByRole('button', { name }) !== null;

describe('FindingActions gating', () => {
  it('shows triage and repairs to an operator on a correctable finding', () => {
    renderActions('OPERATOR', 'expired_externally_active_locally');
    expect(has('Mark reviewed')).toBe(true);
    expect(has('Dismiss')).toBe(true);
    expect(has('Correct entitlement')).toBe(true);
    expect(has('Resolve after verification')).toBe(true);
  });

  it('offers no entitlement correction for other finding types', () => {
    renderActions('OPERATOR', 'refund_inconsistent');
    expect(has('Correct entitlement')).toBe(false);
    expect(has('Resolve after verification')).toBe(true);
  });

  it('renders nothing for a viewer', () => {
    renderActions('VIEWER', 'entitlement_missing_or_stale');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('renders nothing once the finding is closed', () => {
    renderActions('OWNER', 'entitlement_missing_or_stale', 'resolved');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});
