import { pino } from 'pino';

export const LOG_REDACT = {
  paths: [
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["stripe-signature"]',
    'req.headers["paddle-signature"]',
    'req.headers["paypal-transmission-sig"]',
    'req.headers["x-revenuecat-webhook-signature"]',
  ],
  censor: '[REDACTED]',
};

export function createLogger(level: string) {
  return pino({ level, redact: LOG_REDACT });
}
