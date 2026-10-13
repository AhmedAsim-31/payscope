import { expect, test } from '@playwright/test';
import { orgIds, requirePassword, signIn } from './support';

requirePassword();

test.describe('authentication', () => {
  test('sign in, then sign out returns to the login page', async ({ page }) => {
    await signIn(page, 'viewer');
    await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto(`/app/${orgIds().acme}`);
    await expect(page).toHaveURL(/\/login\?next=/);
  });

  test('a protected URL redirects to login and back after sign in', async ({ page }) => {
    const target = `/app/${orgIds().acme}/payments?status=succeeded`;
    await page.goto(target);
    await expect(page).toHaveURL(/\/login\?next=/);
    await signIn(page, 'owner', page.url());
    await expect(page).toHaveURL(target);
    await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
  });

  test('an off-site next parameter is ignored', async ({ page }) => {
    await signIn(page, 'owner', '/login?next=//evil.example');
    await expect(page).toHaveURL(/localhost:3000\/app/);
  });

  test('wrong password shows an error and stays on login', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('demo-owner@example.com');
    await page.getByLabel('Password').fill('definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
