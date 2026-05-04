import { redactLogValue, sanitizeErrorForLog } from './logRedaction';

const isDev = typeof __DEV__ === 'boolean' ? __DEV__ : process.env.NODE_ENV !== 'production';
let globalHandlersInstalled = false;

const formatArgs = (args: unknown[]) => args.map(redactLogValue);

const debug = (...args: unknown[]) => {
  if (!isDev) return;
  console.log(...formatArgs(args));
};

const info = (...args: unknown[]) => {
  if (!isDev) return;
  console.log(...formatArgs(args));
};

const warn = (...args: unknown[]) => {
  console.warn(...formatArgs(args));
};

const error = (err: unknown, context?: Record<string, unknown>) => {
  const safeError = sanitizeErrorForLog(err);
  const safeContext = context ? redactLogValue(context) : undefined;
  if (safeContext) {
    console.error(safeError, safeContext);
    return;
  }
  console.error(safeError);
};

export const log = { debug, info, warn, error };

export const installGlobalErrorHandlers = () => {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;
  const errorUtils: any = (global as any)?.ErrorUtils;
  const previousHandler = typeof errorUtils?.getGlobalHandler === 'function'
    ? errorUtils.getGlobalHandler()
    : undefined;
  if (typeof errorUtils?.setGlobalHandler === 'function') {
    errorUtils.setGlobalHandler((err: unknown, isFatal?: boolean) => {
      log.error(err, { area: 'global', isFatal: Boolean(isFatal) });
      if (typeof previousHandler === 'function') {
        previousHandler(err, isFatal);
      }
    });
  }
};
