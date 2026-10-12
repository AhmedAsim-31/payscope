import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { AuthError, type AuthContext, type TokenVerifier } from './token-verifier';

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | undefined;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const BEARER = /^bearer ([^\s]+)$/i;

export const authenticatePlugin = fp<{ tokenVerifier: TokenVerifier }>(
  (app, { tokenVerifier }, done) => {
    app.decorateRequest('auth', undefined);
    app.decorate('authenticate', async (request: FastifyRequest) => {
      const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
      if (!token) {
        throw new AuthError('UNAUTHENTICATED', 'Missing or malformed bearer token');
      }
      request.auth = await tokenVerifier.verify(token);
    });
    done();
  },
  { name: 'authenticate' },
);
