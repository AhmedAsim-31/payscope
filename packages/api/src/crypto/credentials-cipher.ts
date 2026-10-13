import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';

export const CREDENTIALS_KEY_VERSION = 1;
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

export function createCredentialsCipher(key: Buffer): CredentialsCipher {
  if (key.length !== KEY_BYTES) throw new Error('credentials key must be 32 bytes');
  return {
    encrypt(credentials, aad) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(aad));
      const plaintext = Buffer.from(JSON.stringify(CredentialsSchema.parse(credentials)));
      const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      const ciphertext = Buffer.concat([
        Buffer.from([CREDENTIALS_KEY_VERSION]),
        iv,
        body,
        cipher.getAuthTag(),
      ]);
      return { ciphertext, keyVersion: CREDENTIALS_KEY_VERSION };
    },
    decrypt(ciphertext, aad) {
      if (
        ciphertext.length < 1 + IV_BYTES + TAG_BYTES ||
        ciphertext[0] !== CREDENTIALS_KEY_VERSION
      ) {
        throw new Error('credentials decryption failed');
      }
      try {
        const iv = ciphertext.subarray(1, 1 + IV_BYTES);
        const tag = ciphertext.subarray(ciphertext.length - TAG_BYTES);
        const body = ciphertext.subarray(1 + IV_BYTES, ciphertext.length - TAG_BYTES);
        const decipher = createDecipheriv('aes-256-gcm', key, iv);
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
