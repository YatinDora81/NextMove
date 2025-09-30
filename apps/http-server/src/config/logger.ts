import winston, { createLogger, format, transports, type Logger } from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = path.resolve(process.cwd(), 'logs');
const logFilePath = path.join(logDir, 'main.log');
const MAX_LOG_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

winston.addColors({
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'cyan',
});

const checkAndClearLogFile = async (): Promise<void> => {
  try {
    if (!fs.existsSync(logFilePath)) return;

    const stats = await fs.promises.stat(logFilePath);
    if (stats.size > MAX_LOG_FILE_SIZE) {
      await fs.promises.truncate(logFilePath, 0);
      console.warn('⚠️ main.log exceeded 20MB — cleared log file.');
    }
  } catch (err: unknown) {
    console.error('❌ Failed to check/clear log file:', err);
  }
};

const fileLogFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`)
);

const consoleLogFormat = format.combine(
  format.colorize({ all: true }),
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(info => `${info.timestamp} [${info.level}]: ${info.message}`)
);

const logger = createLogger({
  level: 'debug',
  format: fileLogFormat,
  transports: [
    new transports.Console({ format: consoleLogFormat }),
    new transports.File({ filename: logFilePath }),
  ],
});

const wrappedLogger: Logger = new Proxy(logger, {
  get: (target, prop: keyof Logger) => {
    const original = Reflect.get(target, prop) as Logger[keyof Logger];

    if (typeof original === 'function') {
      return (...args: unknown[]): void => {
        (original as (...args: unknown[]) => void).apply(target, args);
        void checkAndClearLogFile();
      };
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return original;
  },
});

export default wrappedLogger;