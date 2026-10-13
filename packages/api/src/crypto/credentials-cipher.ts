import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const DEFAULT_CREDENTIALS_KEY_VERSION = 1;
const MAX_KEY_VERSION = 255;
export const MAX_WEBHOOK_SECRETS = 2;

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export const CredentialsSchema = z.object({
  webhookSecrets: z.array(z.string().min(1).max(512)).max(MAX_WEBHOOK_SECRETS),
  apiKey: z.string().min(1).max(512).optional(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

export type CredentialsCipher = {
  encrypt(credentials: Credentials, aad: string): { ciphertext: Buffer; keyVersion: number };
  decrypt(ciphertext: Buffer, aad: string): Credentials;
};

export function decodeCredentialsKey(base64: string): Buffer | undefined {
  const key = Buffer.from(base64, 'base64');
  return key.length === KEY_BYTES ? key : undefined;
}

export type CipherOptions = {
  version?: number;
  previous?: ReadonlyMap<number, Buffer>;
};

function isKeyVersion(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= MAX_KEY_VERSION;
}

/** Parses `version:base64,version:base64`; undefined when any entry is malformed or a version repeats. */
export function parsePreviousKeys(raw: string): Map<number, Buffer> | undefined {
  const keys = new Map<number, Buffer>();
  for (const entry of raw.split(',')) {
    const [version, base64, ...rest] = entry.trim().split(':');
    const n = Number(version);
    const key = base64 ? decodeCredentialsKey(base64) : undefined;
    if (rest.length > 0 || !isKeyVersion(n) || !key || keys.has(n)) return undefined;
    keys.set(n, key);
  }
  return keys;
}

export function createCredentialsCipher(key: Buffer, opts: CipherOptions = {}): CredentialsCipher {
  const activeVersion = opts.version ?? DEFAULT_CREDENTIALS_KEY_VERSION;
  const previous = opts.previous ?? new Map<number, Buffer>();
  if (key.length !== KEY_BYTES) throw new Error('credentials key must be 32 bytes');
  if (!isKeyVersion(activeVersion)) throw new Error('credentials key version must be 1 to 255');
  if (previous.has(activeVersion))
    throw new Error('previous keys must not reuse the active version');
  for (const prev of previous.values()) {
    if (prev.length !== KEY_BYTES) throw new Error('credentials key must be 32 bytes');
  }
  return {
    encrypt(credentials, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad));
      const plaintext = Buffer.from(JSON.stringify(CredentialsSchema.parse(credentials)));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const ciphertext = Buffer.concat([
        Buffer.from([activeVersion]),
        iv,
        body,
        cipher.getAuthTag(),
      ]);
      return { ciphertext, keyVersion: activeVersion };
    },
    decrypt(ciphertext, aad) {
      const version = ciphertext[0] ?? 0;
      const decryptKey = version === activeVersion ? key : previous.get(version);
      if (ciphertext.length < 1 + IV_BYTES + TAG_BYTES || !decryptKey) {
        throw new Error('credentials decryption failed');
      }
      try {
        const iv = ciphertext.subarray(1, 1 + IV_BYTES);
        const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
        const body = ciphertext.subarray(1 + IV_BYTES, ciphertext.length - TAG_BYTES);
        const decipher = createDecipheriv('aes-256-gcm', decryptKey, iv);
        decipher.setAAD(Buffer.from(aad));
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
        return CredentialsSchema.parse(JSON.parse(plaintext.toString('utf8')));
      } catch {
        throw new Error('credentials decryption failed');
      }
    },
  };
}
