'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { humanize } from './format';
import type { FilterField } from './filter-config';

type FilterBarProps = {
  label: string;
  fields: readonly FilterField[];
  read: (name: string) => string;
  isFiltered: boolean;
  onChange: (name: string, value: string) => void;
  onApply: (values: Record<string, string>) => void;
  onClear: () => void;
};

const SELECT_CLASS =
  'border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]';

const SEARCH_DEBOUNCE_MS = 300;

type SearchInputProps = {
  id: string;
  name: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
};

function SearchInput({ id, name, placeholder, value, onChange }: SearchInputProps) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (draft.trim() !== value) setDraft(value);
  }

  useEffect(() => {
    const next = draft.trim();
    if (next === value) return;
    const timer = setTimeout(() => onChange(next), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  return (
    <Input
      id={id}
      name={name}
      type="search"
      autoComplete="off"
      spellCheck={false}
      placeholder={placeholder}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
    />
  );
}

export function FilterBar({
  label,
  fields,
  read,
  isFiltered,
  onChange,
  onApply,
  onClear,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const formId = useId();

  return (
    <div className="grid gap-3">
      <Button
        type="button"
        variant="outline"
        className="w-fit md:hidden"
        aria-expanded={open}
        aria-controls={formId}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn('transition-transform', open && 'rotate-180')}
        />
        {isFiltered ? 'Filters (active)' : 'Filters'}
      </Button>
      <form
        id={formId}
        role="search"
        aria-label={label}
        className={cn(
          'grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap',
          open ? 'grid' : 'hidden md:grid',
        )}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const values: Record<string, string> = {};
          for (const field of fields) {
            const value = data.get(field.name);
            if ((field.kind === 'text' || field.kind === 'search') && typeof value === 'string')
              values[field.name] = value.trim();
          }
          onApply(values);
        }}
      >
        {fields
          .filter((field) => field.kind !== 'scope')
          .map((field) => {
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
                ) : field.kind === 'search' ? (
                  <SearchInput
                    id={id}
                    name={field.name}
                    placeholder={field.placeholder}
                    value={read(field.name)}
                    onChange={(value) => onChange(field.name, value)}
                  />
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
                      field.kind === 'date'
                        ? (e) => onChange(field.name, e.target.value)
                        : undefined
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
    </div>
  );
}
