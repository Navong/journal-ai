/**
 * Centralized logging utility for easy tracking and debugging
 * 
 * Usage:
 *   logger.debug('Detailed debug info');
 *   logger.info('General information');
 *   logger.warn('Warning message');
 *   logger.error('Error message', error);
 * 
 * Enable/disable via environment variable: NEXT_PUBLIC_LOG_LEVEL
 * Levels: 'debug' | 'info' | 'warn' | 'error' | 'none'
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

// Get log level from environment (default: 'info' in production, 'debug' in development)
const getLogLevel = (): LogLevel => {
  if (typeof window !== 'undefined') {
    // Client-side
    const envLevel = (window as any).__NEXT_PUBLIC_LOG_LEVEL as LogLevel | undefined;
    if (envLevel && LOG_LEVELS.hasOwnProperty(envLevel)) return envLevel;
    return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
  } else {
    // Server-side
    const envLevel = process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel | undefined;
    if (envLevel && LOG_LEVELS.hasOwnProperty(envLevel)) return envLevel;
    return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
  }
};

const currentLogLevel = getLogLevel();
const minLevel = LOG_LEVELS[currentLogLevel];

const shouldLog = (level: LogLevel): boolean => {
  return LOG_LEVELS[level] >= minLevel;
};

interface LogContext {
  module?: string;
  [key: string]: any;
}

const formatMessage = (level: LogLevel, message: string, context?: LogContext, error?: Error): string => {
  const timestamp = new Date().toISOString();
  const module = context?.module ? `[${context.module}]` : '';
  const contextStr = context && Object.keys(context).length > 0
    ? ` ${JSON.stringify(context)}`
    : '';
  const errorStr = error ? ` ${error.message}${error.stack ? `\n${error.stack}` : ''}` : '';
  
  return `${timestamp} ${level.toUpperCase()} ${module} ${message}${contextStr}${errorStr}`;
};

const logger = {
  debug: (message: string, context?: LogContext) => {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, context));
    }
  },

  info: (message: string, context?: LogContext) => {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, context));
    }
  },

  warn: (message: string, context?: LogContext, error?: Error) => {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, context, error));
    }
  },

  error: (message: string, context?: LogContext, error?: Error) => {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, context, error));
    }
  },

  // Helper to create a logger with a module context
  module: (moduleName: string) => ({
    debug: (message: string, context?: Omit<LogContext, 'module'>) => {
      logger.debug(message, { module: moduleName, ...context });
    },
    info: (message: string, context?: Omit<LogContext, 'module'>) => {
      logger.info(message, { module: moduleName, ...context });
    },
    warn: (message: string, context?: Omit<LogContext, 'module'>, error?: Error) => {
      logger.warn(message, { module: moduleName, ...context }, error);
    },
    error: (message: string, context?: Omit<LogContext, 'module'>, error?: Error) => {
      logger.error(message, { module: moduleName, ...context }, error);
    },
  }),
};

export default logger;

