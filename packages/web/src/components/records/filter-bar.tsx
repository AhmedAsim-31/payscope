'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { humanize } from './format';
import type { FilterField } from './filter-config';

type FilterBarProps = {
  label: string;
  fields: readonly FilterField[];
  read: (name: string) => string;
  isFiltered: boolean;
  onChange: (name: string, value: string) => void;
  onClear: () => void;
};

const SELECT_CLASS =
  'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]';

export function FilterBar({ label, fields, read, isFiltered, onChange, onClear }: FilterBarProps) {
  return (
    <form
      role="search"
      aria-label={label}
      className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        for (const field of fields) {
          const value = data.get(field.name);
          if (field.kind === 'text' && typeof value === 'string')
            onChange(field.name, value.trim());
        }
      }}
    >
      {fields.map((field) => {
        const id = `filter-${field.name}`;
        return (
          <div key={field.name} className="grid gap-1.5 lg:w-44">
            <Label htmlFor={id}>{field.label}</Label>
            {field.kind === 'select' ? (
              <select
                id={id}
                name={field.name}
                value={read(field.name)}
                onChange={(event) => onChange(field.name, event.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">Any</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {humanize(option)}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={id}
                name={field.name}
                type={field.kind === 'date' ? 'date' : 'search'}
                autoComplete="off"
                spellCheck={false}
                placeholder={field.placeholder}
                key={read(field.name)}
                defaultValue={read(field.name)}
                onChange={
                  field.kind === 'date' ? (e) => onChange(field.name, e.target.value) : undefined
                }
              />
            )}
          </div>
        );
      })}
      {fields.some((field) => field.kind === 'text') ? (
        <Button type="submit" variant="secondary">
          Apply
        </Button>
      ) : null}
      {isFiltered ? (
        <Button type="button" variant="ghost" onClick={onClear}>
          Clear filters
        </Button>
      ) : null}
    </form>
  );
}
