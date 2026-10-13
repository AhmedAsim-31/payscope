import { expect, test, type Page } from '@playwright/test';
import { authFile, orgIds, requirePassword } from './support';

requirePassword();

async function openFirstNeedsAttentionEvent(page: Page) {
  await page.goto(`/app/${orgIds().acme}/events?status=needs_attention`);
  const link = page.getByRole('row').getByRole('link').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
}

test.describe('operator', () => {
  test.use({ storageState: authFile('operator') });

  test('retries a needs-attention event', async ({ page }) => {
    await openFirstNeedsAttentionEvent(page);
    await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Retry processing' }).click();
    const dialog = page.getByRole('dialog', { name: 'Retry processing this event?' });
    const retried = page.waitForResponse((r) => r.url().endsWith('/retry') && r.ok());
    await dialog.getByRole('button', { name: 'Retry processing' }).click();
    await retried;

    await expect(dialog).toBeHidden();
    await expect(page.getByText('Needs attention', { exact: true })).toHaveCount(0);
  });
});

test.describe('viewer', () => {
  test.use({ storageState: authFile('viewer') });

  test('has no retry button', async ({ page }) => {
    await openFirstNeedsAttentionEvent(page);
    await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry processing' })).toHaveCount(0);
  });
});
