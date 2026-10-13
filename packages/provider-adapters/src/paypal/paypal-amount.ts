import { parseDecimalToMinor } from '@payscope/shared/money';
import { ProviderError } from '../provider-error';

export function parsePayPalAmount(value: string, currency: string): bigint {
  try {
    return parseDecimalToMinor(value, currency);
  } catch (error) {
    throw new ProviderError('invalid_input', 'PayPal amount is not a valid decimal string', {
      cause: error,
    });
  }
}
