/**
 * "Du är här, just nu" — current date/time context for the AI, shared by mobile + web
 * so both apps resolve relative times identically. Models were getting "om en kvart"
 * (15 min) wrong (creating +1h) because the time/offset wasn't explicit enough and the
 * web prompt had NO time context at all. This builds a strong, worked-example block:
 * the current local time, IANA zone, exact UTC offset, AND pre-computed ISO timestamps
 * for common relative phrases so the model can pattern-match instead of guessing.
 *
 * Pure + dependency-free (Intl + Date only) → runs in RN and the browser.
 */
const pad2 = (n: number): string => String(n).padStart(2, '0');

export const buildTimeContextLines = (now: Date = new Date()): string[] => {
  let timezone = 'UTC';
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }

  let local = now.toISOString();
  try {
    local = new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(now);
  } catch { /* fall back to ISO */ }

  const offMin = -now.getTimezoneOffset();
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;

  const plus = (min: number) => new Date(now.getTime() + min * 60000).toISOString();
  const plusDays = (d: number) => new Date(now.getTime() + d * 86400000).toISOString();

  return [
    `NUVARANDE TID just nu: ${local} (tidszon ${timezone}, UTC-offset ${offset}). ISO (UTC): ${now.toISOString()}.`,
    `Räkna ALLTID ut relativa tider ("idag", "imorgon", "om en kvart", "på fredag kl 11", "om en timme") utifrån denna nuvarande tid och användarens UTC-offset ${offset}. Om användaren anger en annan tidszon, använd den i stället.`,
    'Svenska relativa uttryck: "en kvart" = 15 minuter, "en halvtimme" = 30 minuter, "tre kvart" = 45 minuter, "om en timme" = 60 minuter, "imorgon" = +1 dag, "i övermorgon" = +2 dagar.',
    `Exempel uträknade utifrån NU — använd exakt detta mönster: "om en kvart" → ${plus(15)} · "om en halvtimme" → ${plus(30)} · "om en timme" → ${plus(60)} · "imorgon (samma tid)" → ${plusDays(1)}.`,
    `dueDate och andra tidsfält ska vara ISO 8601 MED tidszonsoffset ${offset} (t.ex. 2026-06-14T11:00:00${offset}), eller korrekt UTC med "Z". Skriv ALDRIG lokal klockslagstid med "Z" — det blir fel tidszon.`,
  ];
};
