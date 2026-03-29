import { decryptWithSource } from '@repo/shared';

const resolveReadableText = (value: unknown) => {
  if (typeof value !== 'string') {
    return typeof value === 'number' ? String(value) : null;
  }

  const result = decryptWithSource(value);
  if (result.source === 'failed') {
    return null;
  }

  return result.value;
};

export const getReadableProtectedText = (primary: unknown, secondary?: unknown, fallback = '') => {
  const primaryValue = resolveReadableText(primary);
  if (primaryValue !== null) {
    return primaryValue;
  }

  const secondaryValue = resolveReadableText(secondary);
  if (secondaryValue !== null) {
    return secondaryValue;
  }

  return fallback;
};
