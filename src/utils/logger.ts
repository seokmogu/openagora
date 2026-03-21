import { createLogger, format, transports } from 'winston';
import path from 'node:path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');

const isProduction = process.env['NODE_ENV'] === 'production';

export const logger = createLogger({
  level: isProduction ? 'info' : 'debug',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    format.errors({ stack: true }),
    format.json(),
  ),
  defaultMeta: { service: 'openagora' },
  transports: [
    new transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
    }),
    new transports.File({
      filename: path.join(LOG_DIR, 'openagora.log'),
      maxsize: 20 * 1024 * 1024,
      maxFiles: 10,
    }),
  ],
});

if (!isProduction) {
  logger.add(
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, service, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp as string} [${service as string}] ${level}: ${message as string}${metaStr}`;
        }),
      ),
    }),
  );
}
