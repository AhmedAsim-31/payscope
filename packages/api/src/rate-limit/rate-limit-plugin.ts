import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import rateLimit, { type FastifyRateLimitStoreCtor } from '@fastify/rate-limit';
import { ApiHttpError } from '../http-error';
import { POLICY_NAMES, rateLimitKey, type PolicyName, type RatePolicies } from './policies';

export type RateLimitHook = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyInstance {
    rateLimitFor: (name: PolicyName) => RateLimitHook;
    rateLimitByMethod: () => RateLimitHook;
  }
}

type Options = { policies: RatePolicies; store?: FastifyRateLimitStoreCtor };

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const rateLimitPlugin = fp<Options>(
  async (app, { policies, store }) => {
    await app.register(rateLimit, { global: false, ...(store ? { store } : {}) });

    const hooks = new Map<PolicyName, RateLimitHook>();
    for (const name of POLICY_NAMES) {
      const { max, windowSec } = policies[name];
      const check = app.createRateLimit({
        max,
        timeWindow: windowSec * 1000,
        keyGenerator: (request) => rateLimitKey(name, request),
      });
      hooks.set(name, async (request, reply) => {
        const result = await check(request);
        if (result.isAllowed || !result.isExceeded) return;
        const retryAfter = Math.max(1, result.ttlInSeconds);
        reply
          .header('retry-after', retryAfter)
          .header('x-ratelimit-limit', result.max)
          .header('x-ratelimit-remaining', 0)
          .header('x-ratelimit-reset', retryAfter);
        request.log.warn({ policy: name }, 'rate_limited');
        throw new ApiHttpError(
          429,
          'RATE_LIMITED',
          `Rate limit exceeded, retry in ${retryAfter} seconds`,
        );
      });
    }

    const hookFor = (name: PolicyName): RateLimitHook => {
      const hook = hooks.get(name);
      if (!hook) throw new Error(`unknown rate limit policy: ${name}`);
      return hook;
    };
    const read = hookFor('authenticatedRead');
    const write = hookFor('authenticatedWrite');

    app.decorate('rateLimitFor', hookFor);
    app.decorate(
      'rateLimitByMethod',
      () => (request, reply) => (SAFE_METHODS.has(request.method) ? read : write)(request, reply),
    );
  },
  { name: 'rate-limit-policies' },
);
