import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { NAV_ITEMS } from './nav-config';
import { SidebarNav } from './sidebar-nav';

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const ORG_ID = '7b0f5a3e-4f64-4a6c-9a53-0f3d5a1c2b10';

function renderNav(path: string) {
  pathname.current = path;
  render(
    <SidebarProvider>
      <SidebarNav orgId={ORG_ID} />
    </SidebarProvider>,
  );
}

describe('SidebarNav', () => {
  it('links only to routes that exist', () => {
    renderNav(`/app/${ORG_ID}`);
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual([`/app/${ORG_ID}`, `/app/${ORG_ID}/members`]);
    expect(hrefs).toHaveLength(NAV_ITEMS.length);
  });

  it('marks Overview current only on the exact org route', () => {
    renderNav(`/app/${ORG_ID}`);
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Members' })).not.toHaveAttribute('aria-current');
  });

  it('marks Members current on its route and leaves Overview unmarked', () => {
    renderNav(`/app/${ORG_ID}/members`);
    expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });
});
