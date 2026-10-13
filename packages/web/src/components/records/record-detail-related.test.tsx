import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api-client';
import type * as ApiClient from '@/lib/api-client';
import { renderWithQuery } from '@/test/render';
import { CustomerDetail } from './customer-detail';
import { PaymentDetail } from './payment-detail';
import { SubscriptionDetail } from './subscription-detail';

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiClient>()),
  apiFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

const mockedFetch = vi.mocked(apiFetch);
const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';
const CONNECTION = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const SUB = '44444444-4444-4444-8444-444444444444';
const PAYMENT = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-03-05T14:07:09.000Z';

const customerRef = { id: CUSTOMER, email: 'a@example.test' };
const payment = {
  id: PAYMENT,
  provider: 'stripe',
  connectionId: CONNECTION,
  providerPaymentId: 'pi_related',
  status: 'succeeded',
  amount: { amountMinor: '1000', currency: 'USD' },
  amountRefunded: { amountMinor: '0', currency: 'USD' },
  customer: customerRef,
  providerCreatedAt: null,
  createdAt: NOW,
};
const event = {
  id: '55555555-5555-4555-8555-555555555555',
  provider: 'stripe',
  connectionId: CONNECTION,
  providerEventId: 'evt_1',
  eventType: 'invoice.paid',
  normalizedType: null,
  status: 'processed',
  attemptCount: 1,
  occurredAt: NOW,
  receivedAt: NOW,
};
const finding = {
  id: '66666666-6666-4666-8666-666666666666',
  type: 'status_mismatch',
  severity: 'high',
  status: 'open',
  subjectType: 'subscription',
  subjectId: SUB,
  recommendedAction: 'review',
  firstSeenRunId: SUB,
  lastSeenRunId: SUB,
  createdAt: NOW,
  updatedAt: NOW,
};
const audit = {
  id: '77777777-7777-4777-8777-777777777777',
  actorId: null,
  actorType: 'system',
  action: 'refresh_from_provider',
  targetType: 'payment',
  targetId: PAYMENT,
  reason: 'Provider says refunded',
  previousState: null,
  resultingState: null,
  outcome: 'success',
  requestId: null,
  createdAt: NOW,
};
const subscription = {
  id: SUB,
  provider: 'stripe',
  connectionId: CONNECTION,
  providerSubscriptionId: 'sub_related',
  status: 'active',
  planRef: null,
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  createdAt: NOW,
};

function page(items: unknown[], nextCursor: string | null = null) {
  return { items, nextCursor };
}

function respond(routes: Record<string, unknown>) {
  mockedFetch.mockImplementation((path: string) => {
    const match = Object.keys(routes).find((prefix) =>
      path.startsWith(`/api/v1/orgs/${ORG}${prefix}`),
    );
    return Promise.resolve(match === undefined ? page([]) : routes[match]);
  });
}

function requested(prefix: string): URLSearchParams {
  const path = mockedFetch.mock.calls
    .map(([p]) => String(p))
    .find((p) => p.startsWith(`/api/v1/orgs/${ORG}${prefix}?`));
  return new URLSearchParams(path?.split('?')[1]);
}

describe('record detail related sections', () => {
  it('shows payment audit history scoped to the payment', async () => {
    respond({
      [`/payments/${PAYMENT}`]: { ...payment, lastEventAt: null, updatedAt: NOW, events: [] },
      '/audit': page([audit], 'next'),
    });
    renderWithQuery(<PaymentDetail orgId={ORG} paymentId={PAYMENT} />);
    expect(await screen.findByText('Provider says refunded')).toBeInTheDocument();
    const q = requested('/audit');
    expect(q.get('targetType')).toBe('payment');
    expect(q.get('targetId')).toBe(PAYMENT);
    expect(q.get('limit')).toBe('5');
    expect(screen.getByRole('link', { name: 'View all audit entries' })).toHaveAttribute(
      'href',
      `/app/${ORG}/audit?targetType=payment&targetId=${PAYMENT}`,
    );
  });

  it('shows customer payments, events and audit timeline', async () => {
    respond({
      [`/customers/${CUSTOMER}`]: {
        id: CUSTOMER,
        email: 'a@example.test',
        displayName: null,
        externalRef: null,
        createdAt: NOW,
        updatedAt: NOW,
        mappings: [],
        subscriptions: [],
        entitlements: [],
      },
      '/payments': page([payment]),
      '/events': page([event]),
    });
    renderWithQuery(<CustomerDetail orgId={ORG} customerId={CUSTOMER} />);
    expect(await screen.findByText('pi_related')).toBeInTheDocument();
    expect(await screen.findByText('invoice.paid')).toBeInTheDocument();
    expect(await screen.findByText('No audit entries yet')).toBeInTheDocument();
    expect(requested('/payments').get('customerId')).toBe(CUSTOMER);
    expect(requested('/events').get('customerId')).toBe(CUSTOMER);
    expect(requested('/audit').get('targetType')).toBe('customer');
  });

  it('shows subscription payments, events and reconciliation findings', async () => {
    respond({
      [`/subscriptions/${SUB}`]: {
        ...subscription,
        customer: customerRef,
        lastEventAt: null,
        updatedAt: NOW,
        entitlements: [],
      },
      '/payments': page([payment]),
      '/events': page([event]),
      '/reconciliation/findings': page([finding]),
    });
    renderWithQuery(<SubscriptionDetail orgId={ORG} subscriptionId={SUB} />);
    expect(await screen.findByText('pi_related')).toBeInTheDocument();
    expect(await screen.findByText('invoice.paid')).toBeInTheDocument();
    expect(await screen.findByText('Status mismatch')).toBeInTheDocument();
    expect(requested('/payments').get('subscriptionId')).toBe(SUB);
    const events = requested('/events');
    expect(events.get('connectionId')).toBe(CONNECTION);
    expect(events.get('objectRef')).toBe('sub_related');
    const findings = requested('/reconciliation/findings');
    expect(findings.get('subjectType')).toBe('subscription');
    expect(findings.get('subjectId')).toBe(SUB);
  });
});
