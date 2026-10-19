const ZERO_DECIMAL = [
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'ISK',
  'JPY',
  'KMF',
  'KRW',
  'PYG',
  'RWF',
  'UGX',
  'UYI',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
];
const THREE_DECIMAL = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  ...Object.fromEntries(ZERO_DECIMAL.map((c) => [c, 0])),
  ...Object.fromEntries(THREE_DECIMAL.map((c) => [c, 3])),
};

const DEFAULT_EXPONENT = 2;
const DECIMAL_PATTERN = /^(-?)(\d+)(?:\.(\d+))?$/;

/** ISO 4217 minor-unit exponent; unknown currencies default to 2. */
export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? DEFAULT_EXPONENT;
}

/** Parses a decimal string to integer minor units with string arithmetic only. */
export function parseDecimalToMinor(value: string, currency: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid decimal amount: ${JSON.stringify(value)}`);
  }
  const [, sign, whole = '', fraction = ''] = match;
  const exponent = currencyExponent(currency);
  if (fraction.length > exponent) {
    throw new Error(`Too many fractional digits for ${currency.toUpperCase()}: ${value}`);
  }
  const minor = BigInt(whole + fraction.padEnd(exponent, '0'));
  return sign === '-' ? -minor : minor;
}

/** Formats minor units with the currency's exact precision; `group` adds thousands separators. */
export function formatMinor(amount: bigint, currency: string, group = false): string {
  const exponent = currencyExponent(currency);
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().padStart(exponent + 1, '0');
  const split = digits.length - exponent;
  const whole = digits.slice(0, split);
  const shown = group ? whole.replace(/\B(?=(\d{3})+$)/g, ',') : whole;
  const body = exponent === 0 ? shown : `${shown}.${digits.slice(split)}`;
  return negative ? `-${body}` : body;
}
