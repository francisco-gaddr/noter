const isDebug = process.env.NODE_ENV !== 'production';

export const logDebug = (...args: unknown[]) => {
  if (!isDebug) return;
  console.debug(...args);
};

export const logWarn = (...args: unknown[]) => {
  console.warn(...args);
};

export const logError = (...args: unknown[]) => {
  console.error(...args);
};
