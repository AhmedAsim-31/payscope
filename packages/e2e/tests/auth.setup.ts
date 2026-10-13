import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { ACME, GLOBEX, ROLES, authFile, requirePassword, signIn } from './support';

requirePassword();

for (const role of ROLES) {
  test(`sign in as ${role}`, async ({ page }) => {
    await signIn(page, role);
    await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}/);
    mkdirSync(dirname(authFile(role)), { recursive: true });
    await page.context().storageState({ path: authFile(role) });

    if (role === 'owner') {
      await page.getByRole('button', { name: 'Switch organization' }).click();
      const idOf = async (name: string) => {
        const href = await page
          .getByRole('menuitem', { name })
          .getByRole('link')
          .or(page.getByRole('menuitem', { name }))
          .first()
          .getAttribute('href');
        return href?.split('/').pop() ?? '';
      };
      writeFileSync(
        authFile('owner').replace('owner.json', 'orgs.json'),
        JSON.stringify({ acme: await idOf(ACME), globex: await idOf(GLOBEX) }),
      );
    }
  });
}
