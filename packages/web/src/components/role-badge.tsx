import type { Role } from '@payscope/shared/permissions';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  OPERATOR: 'Operator',
  VIEWER: 'Viewer',
};

const TONES: Record<Role, string> = {
  OWNER: 'border-transparent bg-primary text-primary-foreground',
  ADMIN: 'border-transparent bg-info-surface text-info',
  OPERATOR: 'border-transparent bg-secondary text-secondary-foreground',
  VIEWER: 'bg-transparent text-muted-foreground',
};

export function roleLabel(role: Role): string {
  return LABELS[role];
}

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return <Badge className={cn(TONES[role], className)}>{LABELS[role]}</Badge>;
}
