import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'backend-service' },
  transports: [
    //
    // - Write all logs with importance level of `error` or less to `error.log`
    // - Write all logs with importance level of `info` or less to `combined.log`
    //
    // Bounded + rotating so logs can't exhaust the (small) Raspberry Pi disk and
    // crash the app. ~5 MB/file: error keeps 3 (≈15 MB), combined keeps 5 (≈25 MB).
    new winston.transports.File({ filename: 'error.log', level: 'error', maxsize: 5_000_000, maxFiles: 3, tailable: true }),
    new winston.transports.File({ filename: 'combined.log', maxsize: 5_000_000, maxFiles: 5, tailable: true }),
  ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    ),
  }));
}

export default logger;
