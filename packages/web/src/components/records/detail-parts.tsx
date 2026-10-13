import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatTimestamp } from './format';

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {children}
    </Link>
  );
}

export function DetailGrid({ children }: { children: ReactNode }) {
  return <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>;
}

export function DetailField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

export function Timestamp({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted-foreground">Not recorded</span>;
  return <time dateTime={value}>{formatTimestamp(value)}</time>;
}

export function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function SectionEmpty({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}
