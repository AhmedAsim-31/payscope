import { LayoutDashboard, Users, type LucideIcon } from 'lucide-react';

export type NavItem = {
  title: string;
  path: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { title: 'Overview', path: '', icon: LayoutDashboard, exact: true },
  { title: 'Members', path: '/members', icon: Users },
];

export function navHref(orgId: string, item: NavItem): string {
  return `/app/${orgId}${item.path}`;
}

export function isNavActive(pathname: string, orgId: string, item: NavItem): boolean {
  const href = navHref(orgId, item);
  return item.exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
