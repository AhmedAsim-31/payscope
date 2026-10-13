import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

export const ROLES = ['owner', 'operator', 'viewer', 'outsider'] as const;
export type Role = (typeof ROLES)[number];

export const PASSWORD = process.env.DEMO_USER_PASSWORD;
export const ACME = 'Acme Streaming (demo)';
export const GLOBEX = 'Globex Apps (demo)';

const authDir = fileURLToPath(new URL('../.auth/', import.meta.url));
export const authFile = (role: Role) => `${authDir}${role}.json`;
export const emailOf = (role: Role) => `demo-${role}@example.com`;

export function requirePassword() {
  test.skip(!PASSWORD, 'DEMO_USER_PASSWORD is not set (add it to the repo-root .env.local)');
}

export function orgIds(): { acme: string; globex: string } {
  return JSON.parse(readFileSync(`${authDir}orgs.json`, 'utf8')) as {
    acme: string;
    globex: string;
  };
}

export async function signIn(page: Page, role: Role, path = '/login') {
  await page.goto(path);
  await page.getByLabel('Email').fill(emailOf(role));
  await page.getByLabel('Password').fill(PASSWORD ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page overflows horizontally').toBeLessThanOrEqual(0);
}
