import type { Role } from '@payscope/shared/permissions';
import { cn } from '@/lib/utils';
import { roleLabel } from '@/components/role-badge';

export function RoleSelect({
  id,
  label,
  value,
  roles,
  disabled,
  onChange,
  className,
}: {
  id?: string;
  label: string;
  value: Role;
  roles: readonly Role[];
  disabled?: boolean;
  onChange: (role: Role) => void;
  className?: string;
}) {
  return (
    <select
      id={id}
      aria-label={id ? undefined : label}
      value={value}
      disabled={disabled}
      onChange={(event) => {
        const next = roles.find((role) => role === event.target.value);
        if (next) onChange(next);
      }}
      className={cn(
        'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      {roles.map((role) => (
        <option key={role} value={role}>
          {roleLabel(role)}
        </option>
      ))}
    </select>
  );
}
