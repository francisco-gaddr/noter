/**
 * Mechanical guard for the hard locked-folder invariant: a locked note/folder must NEVER
 * leak into an external publish surface or a persistent index — not even one the user has
 * momentarily unlocked in the UI. The leak class this catches: feeding the UI's
 * `unlockedProtectedNoteIds` set into a projection/index builder. Those builders must use the
 * EMPTY unlock set (an empty `[]` / `new Set()`, or the `isReadableForAI`/`AI_INDEX_NO_UNLOCK`
 * helpers from @repo/shared).
 *
 * Real bug this was written for: web `nextcloud.ts` passed `unlockedProtectedNoteIds` to
 * `buildNeo4jSyncPlan`, and both calendar-share + markdown-share projections passed it too —
 * so a locked folder open in the UI got mirrored to the external Neo4j graph / published ICS
 * feed / published markdown share. Now blocked here so it can never regress.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LEAK_TOKEN = 'unlockedProtectedNoteIds';

// Builders that emit data to an EXTERNAL feed/share or a persistent index. Their lock filter
// must be the empty unlock set — passing the UI set leaks locked content.
const GUARDED = [
  'buildSafeCalendarProjection', // → published ICS / CalDAV feed
  'buildMarkdownVaultProjection', // → published markdown WebDAV share
  'buildNeo4jSyncPlan', // → external Neo4j graph
  'indexEntities', // → embeddings / vector index
];

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'out', 'coverage', '.git']);

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

/** Full argument string of a call whose `(` is at openIdx (balanced parens). */
function callArgs(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return src.slice(openIdx + 1); // unbalanced — return the rest (still flagged if it leaks)
}

/**
 * Scan a tree for the leak: a GUARDED projection/index builder being passed the UI's
 * `unlockedProtectedNoteIds`. Returns `repo-relative:line — message` strings (empty = clean).
 * Exported so the behaviour itself is testable (see `--selftest`).
 */
export function findUnlockLeaks(root) {
  const offenders = [];
  const roots = ['apps', 'packages'].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  const files = roots.flatMap((r) => walk(r, []));
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    if (!src.includes(LEAK_TOKEN)) continue; // fast path — no UI set referenced at all
    for (const fn of GUARDED) {
      const re = new RegExp(`\\b${fn}\\s*\\(`, 'g');
      let m;
      while ((m = re.exec(src)) !== null) {
        const openIdx = m.index + m[0].length - 1; // index of the '('
        const args = callArgs(src, openIdx);
        if (args.includes(LEAK_TOKEN)) {
          const line = src.slice(0, m.index).split('\n').length;
          offenders.push(`${path.relative(root, file)}:${line} — ${fn}(...) is passed ${LEAK_TOKEN}`);
        }
      }
    }
  }
  return offenders;
}

/**
 * Prove the guard actually catches the leak class it exists for: a synthetic tree where a
 * GUARDED builder IS passed the UI set must be flagged, and a clean tree (empty set) must
 * not. A guard with no negative proof is worthless — this self-test runs in the gate so the
 * detector itself can't silently rot into a no-op.
 */
function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unlock-leak-selftest-'));
  const fails = [];
  try {
    // 1) A leaky tree MUST be flagged — once per guarded builder, to prove each name matches.
    for (const fn of GUARDED) {
      const leakDir = path.join(dir, fn, 'apps');
      fs.mkdirSync(leakDir, { recursive: true });
      fs.writeFileSync(
        path.join(leakDir, 'leak.ts'),
        `const unlockedProtectedNoteIds = new Set<string>();\nexport const x = ${fn}(notes, tasks, unlockedProtectedNoteIds);\n`,
      );
      const found = findUnlockLeaks(path.join(dir, fn));
      if (found.length === 0) fails.push(`guard missed a leak through ${fn}(...)`);
    }
    // 2) A clean tree (empty set) must NOT be flagged (no false positive).
    const cleanDir = path.join(dir, 'clean', 'apps');
    fs.mkdirSync(cleanDir, { recursive: true });
    fs.writeFileSync(
      path.join(cleanDir, 'ok.ts'),
      'const unlockedProtectedNoteIds = new Set<string>();\n' +
        'export const a = buildNeo4jSyncPlan(notes, tasks, new Set());\n' +
        'export const b = indexEntities(notes, tasks, new Set<string>());\n',
    );
    if (findUnlockLeaks(path.join(dir, 'clean')).length !== 0) {
      fails.push('guard raised a FALSE POSITIVE on a clean tree (empty unlock set)');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (fails.length) {
    console.error('check-index-unlock-leak --selftest FAILED:');
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log(`check-index-unlock-leak --selftest: OK (detects leaks through all ${GUARDED.length} guarded builders; no false positives).`);
}

function main() {
  if (process.argv.includes('--selftest')) {
    selftest();
    return;
  }
  const offenders = findUnlockLeaks(process.cwd());
  if (offenders.length) {
    console.error(
      'Locked-content leak guard FAILED — these external-publish / index projections must use the\n' +
        'EMPTY unlock set so a locked note/folder never leaks into a feed, share, graph, or index:\n',
    );
    for (const o of offenders) console.error('  ✗ ' + o);
    console.error(
      "\nFix: pass an empty set ([] / new Set()) — or use isReadableForAI / AI_INDEX_NO_UNLOCK from\n" +
        '@repo/shared — instead of the store’s unlockedProtectedNoteIds.',
    );
    process.exit(1);
  }
  console.log('Locked-content leak guard: OK (no external-publish/index projection receives the UI unlock set).');
}

main();
