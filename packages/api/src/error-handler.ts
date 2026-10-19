import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import type { ApiError } from '@payscope/shared/api-error';
import { AuthError } from './auth/token-verifier';
import { ApiHttpError } from './http-error';

function codeForStatus(status: number): string {
  return (STATUS_CODES[status] ?? 'ERROR').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
}

function send(reply: FastifyReply, status: number, error: Omit<ApiError['error'], 'requestId'>) {
  const body: ApiError = { error: { ...error, requestId: reply.request.id } };
  return reply.status(status).send(body);
}

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  if (hasZodFastifySchemaValidationErrors(error)) {
    return send(reply, 400, {
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      details: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
    });
  }
  if (error instanceof AuthError) {
    if (error.code === 'AUTH_UNAVAILABLE') {
      request.log.warn({ err: error }, 'token key set unavailable');
      return send(reply, 503, { code: error.code, message: error.message });
    }
    reply.header('www-authenticate', 'Bearer');
    return send(reply, 401, { code: error.code, message: error.message });
  }
  if (error instanceof ApiHttpError) {
    return send(reply, error.statusCode, {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    });
  }
  const status = error.statusCode ?? 500;
  if (status < 500) {
    return send(reply, status, {
      code: codeForStatus(status),
      message: STATUS_CODES[status] ?? 'Client error',
    });
  }
  request.log.error({ err: error }, 'request failed');
  return send(reply, status, { code: 'INTERNAL_ERROR', message: 'Internal server error' });
}

export function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
  return send(reply, 404, { code: 'NOT_FOUND', message: 'Route not found' });
}
