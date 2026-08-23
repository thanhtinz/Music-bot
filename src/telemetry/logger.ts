import pino from 'pino';

/**
 * Structured JSON logger (spec §23.2).
 *
 * Secrets are redacted at the logger level rather than at each call site, so a
 * careless `logger.info({ env })` can never leak a token.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'music-bot' },
  redact: {
    paths: [
      'token',
      'DISCORD_TOKEN',
      '*.token',
      '*.password',
      '*.authorization',
      'headers.authorization',
      'headers.cookie',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Creates a child logger tagged with a module name and optional correlation id. */
export function createLogger(module: string, correlationId?: string) {
  return logger.child(correlationId ? { module, correlationId } : { module });
}
