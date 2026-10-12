import { errors, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

export type AuthErrorCode = 'UNAUTHENTICATED' | 'TOKEN_EXPIRED' | 'INVALID_TOKEN';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
  }
}

export type AuthContext = {
  userId: string;
  email: string | undefined;
  role: string | undefined;
  sessionId: string | undefined;
};

export type TokenVerifier = { verify: (token: string) => Promise<AuthContext> };

const claimsSchema = z.object({
  sub: z.uuid(),
  email: z.string().optional(),
  role: z.string().optional(),
  session_id: z.string().optional(),
});

const CLOCK_TOLERANCE_SECONDS = 5;

export function createTokenVerifier(opts: {
  issuer: string;
  audience: string;
  keySet: JWTVerifyGetKey;
}): TokenVerifier {
  return {
    async verify(token) {
      let payload: unknown;
      try {
        ({ payload } = await jwtVerify(token, opts.keySet, {
          issuer: opts.issuer,
          audience: opts.audience,
          algorithms: ['ES256', 'RS256'],
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
        }));
      } catch (err) {
        if (err instanceof errors.JWTExpired) {
          throw new AuthError('TOKEN_EXPIRED', 'Access token has expired');
        }
        throw new AuthError('INVALID_TOKEN', 'Access token is invalid');
      }
      const claims = claimsSchema.safeParse(payload);
      if (!claims.success) throw new AuthError('INVALID_TOKEN', 'Access token is invalid');
      return {
        userId: claims.data.sub,
        email: claims.data.email,
        role: claims.data.role,
        sessionId: claims.data.session_id,
      };
    },
  };
}
