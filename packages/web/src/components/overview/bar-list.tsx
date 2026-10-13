import { humanize } from '@/components/records/format';

export type BarItem = { key: string; value: number };

export function BarList({ items, label }: { items: BarItem[]; label: string }) {
  const visible = items.filter((item) => item.value > 0);
  if (visible.length === 0) return <p className="text-muted-foreground text-sm">None</p>;
  const max = Math.max(...visible.map((item) => item.value));

  return (
    <ul aria-label={label} className="grid gap-2">
      {visible.map((item) => (
        <li key={item.key} className="grid gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span>{humanize(item.key)}</span>
            <span className="font-medium tabular-nums">{item.value}</span>
          </div>
          <div className="bg-muted h-1.5 rounded-full" aria-hidden="true">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function barItems(counts: Readonly<Record<string, number>>): BarItem[] {
  return Object.entries(counts).map(([key, value]) => ({ key, value }));
}
