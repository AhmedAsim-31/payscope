import type { CurrencyOverview } from '@payscope/shared/overview-schemas';
import { formatMoney } from '@/components/records/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarList, barItems } from './bar-list';

export function CurrencyCard({ data }: { data: CurrencyOverview }) {
  const money = (amountMinor: string) => formatMoney({ amountMinor, currency: data.currency });

  return (
    <Card aria-label={`${data.currency} payments`}>
      <CardHeader>
        <CardTitle className="flex items-baseline justify-between gap-2 text-base">
          <span>{data.currency}</span>
          <span className="text-muted-foreground text-sm font-normal">
            {data.total} {data.total === 1 ? 'payment' : 'payments'}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-2 gap-3">
          <div>
            <dt className="text-muted-foreground text-xs">Succeeded</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {money(data.succeededAmountMinor)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">Refunded</dt>
            <dd className="text-lg font-semibold tabular-nums">
              {money(data.refundedAmountMinor)}
            </dd>
          </div>
        </dl>
        <BarList label={`${data.currency} payments by status`} items={barItems(data.byStatus)} />
      </CardContent>
    </Card>
  );
}
