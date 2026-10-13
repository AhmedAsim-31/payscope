import { ApiHttpError } from '../http-error';

const UNIQUE_VIOLATION = '23505';
const RAISE_EXCEPTION = 'P0001';

function pgError(err: unknown): { code?: string; message?: string } | undefined {
  let current = err;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth++) {
    if ('code' in current && typeof current.code === 'string' && current.code.length === 5) {
      return {
        code: current.code,
        message: 'message' in current && typeof current.message === 'string' ? current.message : '',
      };
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

export function pgErrorCode(err: unknown): string | undefined {
  return pgError(err)?.code;
}

export function rethrowPgError(err: unknown): never {
  const pg = pgError(err);
  if (pg?.code === UNIQUE_VIOLATION) {
    throw new ApiHttpError(409, 'CONFLICT', 'Resource already exists');
  }
  if (pg?.code === RAISE_EXCEPTION && pg.message === 'last_owner') {
    throw new ApiHttpError(409, 'LAST_OWNER', 'An organization must keep at least one owner');
  }
  throw err;
}
