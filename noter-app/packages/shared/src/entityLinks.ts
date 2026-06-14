/**
 * Explicit entity links — the user-drawn graph edges stored on a note/task as
 * `links: EntityLink[]`. Persisted as an ENCRYPTED JSON string (one column, like the
 * AI delegation), so these helpers centralise the (de)serialisation used by web +
 * mobile so the encrypted blob ↔ array round-trip is identical everywhere.
 */
import type { EntityLink } from './types';

/** Default relation label when the user draws a link without picking a type. */
export const DEFAULT_LINK_REL = 'linked';

/** Tolerantly parse a links value: an array already, or a JSON string. Invalid → []. */
export const parseEntityLinks = (raw: unknown): EntityLink[] => {
  let arr: any = raw;
  if (raw == null || raw === '') return [];
  if (typeof raw === 'string') {
    try { arr = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: EntityLink[] = [];
  for (const item of arr) {
    const targetId = item && typeof item.targetId === 'string' ? item.targetId.trim() : '';
    if (!targetId || seen.has(targetId)) continue;
    seen.add(targetId);
    const rel = item && typeof item.rel === 'string' && item.rel.trim() ? item.rel.trim() : DEFAULT_LINK_REL;
    out.push({ targetId, rel });
  }
  return out;
};

/** Serialize links to a JSON string for the encrypted column ('' when none). */
export const serializeEntityLinks = (links?: EntityLink[] | null): string =>
  links && links.length ? JSON.stringify(parseEntityLinks(links)) : '';

/** Toggle a link to a target on/off (used by the form pickers). */
export const toggleEntityLink = (links: EntityLink[] | undefined, targetId: string, rel = DEFAULT_LINK_REL): EntityLink[] => {
  const current = parseEntityLinks(links);
  const exists = current.some((l) => l.targetId === targetId);
  return exists ? current.filter((l) => l.targetId !== targetId) : [...current, { targetId, rel }];
};
