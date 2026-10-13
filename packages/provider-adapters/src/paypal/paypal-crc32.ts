import { crc32 } from 'node:zlib';

export function paypalCrc32(body: Buffer): number {
  return crc32(body);
}
