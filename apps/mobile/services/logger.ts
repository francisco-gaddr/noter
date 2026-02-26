const isDebug = typeof __DEV__ !== 'undefined' ? __DEV__ : false;

export const logDebug = (...args: unknown[]) => {
  if (!isDebug) return;
  console.log(...args);
};

export const logWarn = (...args: unknown[]) => {
  console.warn(...args);
};

export const logError = (...args: unknown[]) => {
  console.error(...args);
};
