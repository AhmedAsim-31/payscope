import { expect, test } from '@playwright/test';
import { authFile, orgIds, requirePassword } from './support';

requirePassword();
test.use({ storageState: authFile('owner') });

test('run the duplicate webhook scenario, then reset the lab', async ({ page }) => {
  await page.goto(`/app/${orgIds().acme}/scenarios`);
  const card = page.locator('div[data-slot="card"]').filter({ hasText: '5. Duplicate webhook' });
  await card.getByRole('button', { name: 'Run scenario' }).click();
  const result = card.getByLabel('Scenario result');
  await expect(result.getByText('The expected outcome was observed.')).toBeVisible({
    timeout: 30_000,
  });
  await expect(result.getByText('Passed', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Reset scenario lab' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset the scenario lab?' });
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(card.getByLabel('Scenario result')).toHaveCount(0);
});
