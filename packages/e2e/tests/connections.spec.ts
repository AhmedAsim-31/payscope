import { expect, test } from '@playwright/test';
import { authFile, orgIds, requirePassword } from './support';

requirePassword();
test.use({ storageState: authFile('owner') });

test('owner sees connections with manage controls and honest simulation labels', async ({
  page,
}) => {
  await page.goto(`/app/${orgIds().acme}/connections`);
  await expect(page.getByRole('heading', { name: 'Connections' })).toBeVisible();
  const card = page.locator('[data-slot="card"]', { hasText: 'Stripe simulation (demo)' });
  await expect(card).toBeVisible();
  await expect(card.getByText('Simulated', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: 'Test credentials' })).toBeDisabled();
  await expect(card.getByText('Simulated connections have no provider account.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add connection' })).toBeVisible();
});
