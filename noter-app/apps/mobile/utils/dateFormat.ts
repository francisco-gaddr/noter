/**
 * Locale-aware date/time formatters.
 *
 * Built on Intl.DateTimeFormat + Intl.RelativeTimeFormat which are now
 * fully supported on Hermes (RN 0.72+) and JSC. We resolve the device
 * locale lazily on first use so unit tests can override via `setLocale()`.
 *
 * Why centralise: scattered `toLocaleString()` / `toLocaleDateString()`
 * calls produced inconsistent output across screens (sv-SE on settings,
 * en-US on note headers). One module = one formatting policy.
 */

import * as Localization from 'expo-localization';

let cachedLocale: string | null = null;

const resolveLocale = (): string => {
  if (cachedLocale) return cachedLocale;
  try {
    const locales = Localization.getLocales?.();
    const tag = locales && locales[0]?.languageTag;
    cachedLocale = (typeof tag === 'string' && tag.length > 0) ? tag : 'en-US';
  } catch {
    cachedLocale = 'en-US';
  }
  return cachedLocale;
};

export const setLocale = (loc: string | null): void => {
  cachedLocale = loc;
};

const safeDate = (input: Date | string | number): Date | null => {
  const d = input instanceof Date ? input : new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
};

/** Short day-precision format (e.g. "2026-05-19" or "May 19, 2026" per locale). */
export const formatDate = (input: Date | string | number, opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string => {
  const d = safeDate(input);
  if (!d) return '';
  try { return new Intl.DateTimeFormat(resolveLocale(), opts).format(d); } catch { return d.toISOString().slice(0, 10); }
};

/** Time only — "14:32" / "2:32 PM" per locale. */
export const formatTime = (input: Date | string | number, opts: Intl.DateTimeFormatOptions = { timeStyle: 'short' }): string => {
  const d = safeDate(input);
  if (!d) return '';
  try { return new Intl.DateTimeFormat(resolveLocale(), opts).format(d); } catch { return d.toISOString().slice(11, 16); }
};

/** Combined date + time. */
export const formatDateTime = (input: Date | string | number): string => {
  const d = safeDate(input);
  if (!d) return '';
  try {
    return new Intl.DateTimeFormat(resolveLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(d);
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16);
  }
};

/**
 * "5 minutes ago" / "in 2 hours" — uses Intl.RelativeTimeFormat with
 * "auto" numeric so we get "yesterday"/"tomorrow" when the unit is 1.
 * Falls back to formatDate() when the magnitude exceeds a reasonable
 * "recent" window (> 30 days).
 */
export const formatRelative = (input: Date | string | number, now: Date = new Date()): string => {
  const d = safeDate(input);
  if (!d) return '';
  const diffMs = d.getTime() - now.getTime();
  const abs = Math.abs(diffMs);

  // Beyond ~30 days the relative phrasing reads worse than absolute.
  if (abs > 30 * 24 * 60 * 60 * 1000) return formatDate(d);

  const units: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
    { unit: 'year', ms: 365 * 24 * 60 * 60 * 1000 },
    { unit: 'month', ms: 30 * 24 * 60 * 60 * 1000 },
    { unit: 'week', ms: 7 * 24 * 60 * 60 * 1000 },
    { unit: 'day', ms: 24 * 60 * 60 * 1000 },
    { unit: 'hour', ms: 60 * 60 * 1000 },
    { unit: 'minute', ms: 60 * 1000 },
    { unit: 'second', ms: 1000 },
  ];

  for (const { unit, ms } of units) {
    if (abs >= ms || unit === 'second') {
      const value = Math.round(diffMs / ms);
      try {
        const rtf = new Intl.RelativeTimeFormat(resolveLocale(), { numeric: 'auto' });
        return rtf.format(value, unit);
      } catch {
        // Engines without Intl.RelativeTimeFormat — fall through to absolute.
        return formatDateTime(d);
      }
    }
  }
  return formatDateTime(d);
};

/** Test helper. */
export const _getResolvedLocale = (): string => resolveLocale();
