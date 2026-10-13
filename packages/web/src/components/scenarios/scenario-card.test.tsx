import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SCENARIOS, type ScenarioCatalogItem } from '@payscope/shared/scenario-schemas';
import { renderWithQuery } from '@/test/render';
import { ScenarioCard } from './scenario-card';

const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const FIRST = SCENARIOS[0];

function scenario(lastRun: ScenarioCatalogItem['lastRun']): ScenarioCatalogItem {
  return { ...FIRST, mode: 'Local simulation', lastRun };
}

const passedRun = {
  id: '11111111-1111-4111-8111-111111111111',
  scenarioId: FIRST.id,
  status: 'passed' as const,
  startedAt: '2026-10-13T10:00:00.000Z',
  finishedAt: '2026-10-13T10:00:01.000Z',
  error: null,
  result: {
    checks: [{ label: 'Payment record is succeeded', passed: true }],
    evidence: {
      eventIds: ['22222222-2222-4222-8222-222222222222'],
      jobIds: [],
      findingIds: [],
      runIds: [],
      paymentIds: ['33333333-3333-4333-8333-333333333333'],
      subscriptionIds: [],
      entitlementIds: [],
      http: [],
      notes: [],
    },
  },
};

describe('ScenarioCard', () => {
  it('labels the scenario as a local simulation and shows the expected outcome', () => {
    renderWithQuery(<ScenarioCard orgId={ORG} scenario={scenario(null)} canRun />);
    expect(screen.getByText('Local simulation')).toBeInTheDocument();
    expect(screen.getByText(FIRST.expectedOutcome, { exact: false })).toBeInTheDocument();
  });

  it('hides the run button from users who cannot run scenarios', () => {
    renderWithQuery(<ScenarioCard orgId={ORG} scenario={scenario(null)} canRun={false} />);
    expect(screen.queryByRole('button', { name: 'Run scenario' })).toBeNull();
  });

  it('shows the last result with links to the evidence pages', () => {
    renderWithQuery(<ScenarioCard orgId={ORG} scenario={scenario(passedRun)} canRun />);
    expect(screen.getByText('The expected outcome was observed.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Events 1' })).toHaveAttribute(
      'href',
      `/app/${ORG}/events/22222222-2222-4222-8222-222222222222`,
    );
    expect(screen.getByRole('link', { name: 'Payments 1' })).toHaveAttribute(
      'href',
      `/app/${ORG}/payments/33333333-3333-4333-8333-333333333333`,
    );
  });

  it('reports a failed expectation', () => {
    const failed = {
      ...passedRun,
      status: 'failed' as const,
      result: {
        ...passedRun.result,
        checks: [{ label: 'Check', passed: false, detail: 'pending' }],
      },
    };
    renderWithQuery(<ScenarioCard orgId={ORG} scenario={scenario(failed)} canRun />);
    expect(screen.getByText('The expected outcome was not observed.')).toBeInTheDocument();
    expect(screen.getByText('(pending)')).toBeInTheDocument();
  });
});
