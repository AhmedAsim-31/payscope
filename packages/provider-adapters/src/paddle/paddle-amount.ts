import { ProviderError } from '../provider-error';

const MINOR_UNITS = /^-?\d+$/;

export function parsePaddleMinorUnits(value: string): bigint {
  if (!MINOR_UNITS.test(value)) {
    throw new ProviderError('invalid_input', 'Paddle amount is not an integer minor-unit string');
  }
  return BigInt(value);
}
