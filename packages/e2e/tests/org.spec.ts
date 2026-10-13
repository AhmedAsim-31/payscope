import { expect, test } from '@playwright/test';
import { ACME, GLOBEX, authFile, orgIds, requirePassword } from './support';

requirePassword();

test.describe('organizations', () => {
  test.use({ storageState: authFile('owner') });

  test('owner switches between Acme and Globex', async ({ page }) => {
    const { acme, globex } = orgIds();
    await page.goto(`/app/${acme}`);
    const switcher = page.getByRole('button', { name: 'Switch organization' });
    await expect(switcher).toContainText(ACME);

    await switcher.click();
    await page.getByRole('menuitem', { name: GLOBEX }).click();
    await expect(page).toHaveURL(`/app/${globex}`);
    await expect(switcher).toContainText(GLOBEX);

    await switcher.click();
    await page.getByRole('menuitem', { name: ACME }).click();
    await expect(page).toHaveURL(`/app/${acme}`);
    await expect(switcher).toContainText(ACME);
  });

  test('payments in one org never show the other org customers', async ({ page }) => {
    await page.goto(`/app/${orgIds().globex}/customers`);
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
    await expect(page.getByText('maya.patel@example.com')).toHaveCount(0);
  });
});

test.describe('cross-tenant access', () => {
  test.use({ storageState: authFile('outsider') });

  test('outsider gets a not-found page for Acme', async ({ page }) => {
    await page.goto(`/app/${orgIds().acme}/payments`);
    await expect(page.getByRole('heading', { name: 'Organization not found' })).toBeVisible();
    await expect(page.getByText('maya.patel@example.com')).toHaveCount(0);

    await page.getByRole('button', { name: 'Switch organization' }).click();
    await expect(page.getByRole('menuitem', { name: ACME })).toHaveCount(0);
  });
});
