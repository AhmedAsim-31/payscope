import fp from 'fastify-plugin';
import { ApiHttpError } from '../http-error';

const API_PREFIX = '/api/v1';
const MAX_JSON_DEPTH = 20;

function exceedsDepth(value: unknown, depth = 0): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (depth >= MAX_JSON_DEPTH) return true;
  return Object.values(value).some((child) => exceedsDepth(child, depth + 1));
}

function isApiPath(url: string): boolean {
  return url === API_PREFIX || url.startsWith(`${API_PREFIX}/`) || url.startsWith(`${API_PREFIX}?`);
}

export const apiHardeningPlugin = fp(
  (app, _opts, done) => {
    app.addHook('onRequest', (request, _reply, hookDone) => {
      const hasBody =
        request.headers['transfer-encoding'] !== undefined ||
        Number(request.headers['content-length'] ?? 0) > 0;
      const bodyless = request.method === 'GET' || request.method === 'HEAD';
      if (isApiPath(request.url) && bodyless && hasBody) {
        hookDone(new ApiHttpError(400, 'BAD_REQUEST', 'GET requests must not have a body'));
        return;
      }
      hookDone();
    });

    app.addHook('preValidation', (request, _reply, hookDone) => {
      if (isApiPath(request.url) && exceedsDepth(request.body)) {
        hookDone(new ApiHttpError(400, 'BAD_REQUEST', 'JSON body is nested too deeply'));
        return;
      }
      hookDone();
    });

    app.addHook('onSend', (request, reply, _payload, hookDone) => {
      if (isApiPath(request.url) && !reply.hasHeader('cache-control')) {
        reply.header('cache-control', 'no-store');
      }
      hookDone();
    });
    done();
  },
  { name: 'api-hardening' },
);
