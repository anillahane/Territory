type LogContext = unknown;
type LogMethod = 'debug' | 'info' | 'warn' | 'error';

const isTest = import.meta.env.MODE === 'test';
const shouldWriteVerboseLogs = import.meta.env.DEV && !isTest;
const shouldWriteOperationalLogs = !isTest;

const writeLog = (method: LogMethod, message: string, context?: LogContext) => {
  const shouldWrite =
    method === 'debug' || method === 'info'
      ? shouldWriteVerboseLogs
      : shouldWriteOperationalLogs;

  if (!shouldWrite) {
    return;
  }

  if (context === undefined) {
    console[method](message);
    return;
  }

  console[method](message, context);
};

const logger = {
  debug: (message: string, context?: LogContext) => writeLog('debug', message, context),
  info: (message: string, context?: LogContext) => writeLog('info', message, context),
  warn: (message: string, context?: LogContext) => writeLog('warn', message, context),
  error: (message: string, context?: LogContext) => writeLog('error', message, context),
};

export default logger;
