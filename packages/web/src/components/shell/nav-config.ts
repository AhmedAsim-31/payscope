import {
  CreditCard,
  Inbox,
  History,
  Scale,
  SearchCheck,
  Siren,
  Wrench,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Repeat,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = {
  title: string;
  path: string;
  icon: LucideIcon;
  exact?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { title: 'Overview', path: '', icon: LayoutDashboard, exact: true },
  { title: 'Payments', path: '/payments', icon: CreditCard },
  { title: 'Subscriptions', path: '/subscriptions', icon: Repeat },
  { title: 'Customers', path: '/customers', icon: UserRound },
  { title: 'Entitlements', path: '/entitlements', icon: KeyRound },
  { title: 'Events', path: '/events', icon: Inbox },
  { title: 'Jobs', path: '/jobs', icon: ListChecks },
  { title: 'Reconciliation', path: '/reconciliation', icon: Scale },
  { title: 'Findings', path: '/findings', icon: SearchCheck },
  { title: 'Incidents', path: '/incidents', icon: Siren },
  { title: 'Repair center', path: '/repairs', icon: Wrench },
  { title: 'Audit', path: '/audit', icon: History },
  { title: 'Members', path: '/members', icon: Users },
];

export function navHref(orgId: string, item: NavItem): string {
  return `/app/${orgId}${item.path}`;
}

export function isNavActive(pathname: string, orgId: string, item: NavItem): boolean {
  const href = navHref(orgId, item);
  return item.exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}
