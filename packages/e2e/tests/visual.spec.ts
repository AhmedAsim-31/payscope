import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  authFile,
  expectNoHorizontalOverflow,
  expectSidebarSpansDocument,
  orgIds,
  requirePassword,
} from './support';

requirePassword();
test.use({ storageState: authFile('owner') });
test.setTimeout(120_000);

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
  ['connections', '/connections'],
  ['members', '/members'],
] as const;
const WIDTHS = [375, 768, 1280] as const;
const SCHEMES = ['light', 'dark'] as const;

for (const [name, path] of PAGES) {
  test(`${name}: layout, screenshots, axe`, async ({ page }, info) => {
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/app/${orgIds().acme}${path}`);
        await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
        if (width === 375) await expectNoHorizontalOverflow(page);
        else await expectSidebarSpansDocument(page);
        await page.screenshot({
          path: info.outputPath(`${name}-${scheme}-${width}.png`),
          fullPage: true,
        });
        if (width !== 1280) continue;
        const { violations } = await new AxeBuilder({ page }).analyze();
        const blocking = violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        );
        expect(
          blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
          `axe (${scheme})`,
        ).toEqual([]);
      }
    }
  });
}
