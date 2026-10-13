import { currencyExponent, parseDecimalToMinor } from '@payscope/shared/money';

/** Uses the JSON float's shortest decimal string; null (never rounded) for exponent form or excess fraction digits. */
export function revenueCatPriceToMinor(price: number, currency: string): bigint | null {
  if (!Number.isFinite(price)) return null;
  const text = String(price);
  if (/e/i.test(text)) return null;
  const fraction = text.split('.')[1] ?? '';
  if (fraction.length > currencyExponent(currency)) return null;
  return parseDecimalToMinor(text, currency);
}
