import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResourceNotFound } from './resource-not-found';

const ORG = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';

vi.mock('next/navigation', () => ({ useParams: () => ({ orgId: ORG }) }));

describe('ResourceNotFound', () => {
  it('names the missing resource and links back to its list', () => {
    render(<ResourceNotFound label="Payment" listPath="payments" />);
    expect(screen.getByRole('heading', { name: 'Payment not found' })).toBeVisible();
    expect(screen.queryByText('Organization not found')).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to payments' })).toHaveAttribute(
      'href',
      `/app/${ORG}/payments`,
    );
  });
});

describe('detail routes', () => {
  it('give every detail segment its own not-found page', () => {
    const orgDir = `${resolve(process.cwd(), 'src/app/app/[orgId]')}/`;
    const detailDirs = readdirSync(orgDir, { withFileTypes: true }).flatMap((section) =>
      section.isDirectory()
        ? readdirSync(`${orgDir}${section.name}`, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() && entry.name.startsWith('['))
            .map((entry) => `${orgDir}${section.name}/${entry.name}`)
        : [],
    );
    expect(detailDirs.length).toBeGreaterThanOrEqual(8);
    expect(detailDirs.filter((dir) => !existsSync(`${dir}/not-found.tsx`))).toEqual([]);
  });
});
