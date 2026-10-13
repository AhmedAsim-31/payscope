import { ProviderError } from '../provider-error';

export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result: unknown = await reader.read();
    const value = typeof result === 'object' && result && 'value' in result ? result.value : null;
    if (!(value instanceof Uint8Array)) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ProviderError('permanent', 'PayPal response exceeded size limit');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
