import { expect, test } from '@playwright/test';
import { authFile, expectNoHorizontalOverflow, orgIds, requirePassword } from './support';

requirePassword();
test.use({ storageState: authFile('owner') });

const PAGES = [
  ['overview', ''],
  ['payments', '/payments'],
  ['subscriptions', '/subscriptions'],
  ['customers', '/customers'],
  ['entitlements', '/entitlements'],
  ['events', '/events'],
  ['jobs', '/jobs'],
  ['reconciliation', '/reconciliation'],
  ['findings', '/findings'],
  ['incidents', '/incidents'],
  ['repairs', '/repairs'],
  ['scenarios', '/scenarios'],
  ['audit', '/audit'],
  ['members', '/members'],
] as const;

for (const [name, path] of PAGES) {
  test(`${name} renders without overflow`, async ({ page }, info) => {
    await page.goto(`/app/${orgIds().acme}${path}`);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('main').getByRole('status')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`${name}.png`), fullPage: true });
  });
}
