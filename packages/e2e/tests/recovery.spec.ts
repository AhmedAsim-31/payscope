import { expect, test } from '@playwright/test';
import { authFile, orgIds, requirePassword } from './support';

requirePassword();
test.use({ storageState: authFile('owner') });

test('reconcile, find the missing entitlement, repair it with a reason', async ({ page }) => {
  const { acme } = orgIds();

  await page.goto(`/app/${acme}/customers`);
  await page.getByLabel('Email starts with').fill('maya.patel@example.com');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/email=maya/);
  const customerLink = page.getByRole('row').getByRole('link', { name: 'maya.patel@example.com' });
  await expect(customerLink).toBeVisible();
  const customerId = (await customerLink.getAttribute('href'))?.split('/').pop() ?? '';
  expect(customerId).toMatch(/^[0-9a-f-]{36}$/);

  await page.goto(`/app/${acme}/reconciliation`);
  await page.getByLabel('Mode').selectOption('local');
  await page.getByRole('button', { name: 'Start run' }).click();
  const latestRun = page.getByRole('row', { name: /Local/ }).first();
  await expect(async () => {
    await page.reload();
    await expect(latestRun).toContainText(/Completed|Passed|Partial/, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });

  await page.goto(`/app/${acme}/findings?type=entitlement_missing_or_stale&status=open`);
  await expect(page.getByRole('row').getByRole('link').first()).toBeVisible();
  const hrefs = await page
    .getByRole('row')
    .getByRole('link')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''));
  let found = false;
  for (const href of hrefs) {
    await page.goto(href);
    await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
    if ((await page.getByText(customerId).count()) > 0) {
      found = true;
      break;
    }
  }
  expect(found, 'finding for maya.patel@example.com').toBe(true);
  const findingUrl = page.url();
  await expect(page.getByRole('heading', { name: 'Entitlement missing or stale' })).toBeVisible();

  await page.getByRole('button', { name: 'Correct entitlement' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct the entitlement?' });
  await dialog
    .getByLabel('Reason')
    .fill('E2E check: active pro subscription with a succeeded payment.');
  await dialog.getByRole('button', { name: 'Correct entitlement' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText('Resolved', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Correct entitlement' })).toHaveCount(0);

  await page.goto(`/app/${acme}/audit?action=repair.correct_entitlement`);
  const row = page.getByRole('row', { name: /repair\.correct_entitlement/ }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText('E2E check');
  expect(findingUrl).toContain('/findings/');
});
