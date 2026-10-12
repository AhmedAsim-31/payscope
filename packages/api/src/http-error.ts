export class ApiHttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = 'ApiHttpError';
    this.statusCode = statusCode;
    this.code = code;
  }
}
