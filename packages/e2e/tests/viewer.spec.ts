import { expect, test } from '@playwright/test';
import { authFile, orgIds, requirePassword } from './support';

requirePassword();
test.use({ storageState: authFile('viewer') });

test('viewer sees no manage controls', async ({ page }) => {
  const { acme } = orgIds();

  await page.goto(`/app/${acme}/members`);
  await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
  await expect(page.getByLabel('Email')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /remove/i })).toHaveCount(0);

  await page.goto(`/app/${acme}/repairs`);
  await expect(page.getByText('Your role can view repairs but not run them.')).toBeVisible();

  await page.goto(`/app/${acme}/scenarios`);
  await expect(page.getByRole('heading', { name: 'Scenario lab' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run scenario' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset scenario lab' })).toHaveCount(0);

  await page.goto(`/app/${acme}/reconciliation`);
  await expect(page.getByRole('heading', { name: 'Reconciliation' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start run' })).toHaveCount(0);
});
