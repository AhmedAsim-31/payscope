import { expect, test } from '@playwright/test';
import { authFile, orgIds, requirePassword } from './support';

requirePassword();
test.use({ storageState: authFile('owner') });

test('filter payments by currency, then investigate one', async ({ page }) => {
  await page.goto(`/app/${orgIds().acme}/payments`);
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();

  await page.getByLabel('Currency').fill('eur');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/currency=eur/i);

  const rows = page.getByRole('row').filter({ has: page.getByRole('link') });
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasNotText: 'EUR' })).toHaveCount(0);

  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(/\/payments\/[0-9a-f-]{36}$/);
  await expect(page.getByText('charged amount, not net payout')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related provider events' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: 'Provider time' }).first(),
  ).toBeVisible();
});

test('unknown payment shows a payment-specific not-found page', async ({ page }) => {
  await page.goto(`/app/${orgIds().acme}/payments/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByRole('heading', { name: 'Payment not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to payments' })).toBeVisible();
});
