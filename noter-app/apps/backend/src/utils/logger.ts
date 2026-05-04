import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { sanitizeLogInfo } from './logRedaction';

const isProduction = process.env.NODE_ENV === 'production';
const logDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logDir, { recursive: true });

const fileTransportOptions = {
  maxsize: 5 * 1024 * 1024,
  maxFiles: 5,
};

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format((info) => sanitizeLogInfo(info as any) as any)(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'backend-service' },
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error', ...fileTransportOptions }),
    new winston.transports.File({ filename: path.join(logDir, 'combined.log'), ...fileTransportOptions }),
  ],
});

logger.add(new winston.transports.Console({
  format: isProduction
    ? winston.format.combine(
        winston.format((info) => sanitizeLogInfo(info as any) as any)(),
        winston.format.timestamp(),
        winston.format.json(),
      )
    : winston.format.combine(
        winston.format((info) => sanitizeLogInfo(info as any) as any)(),
        winston.format.colorize(),
        winston.format.simple(),
      ),
}));

export default logger;
