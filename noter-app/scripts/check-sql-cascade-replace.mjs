#!/usr/bin/env node
/**
 * Static review gate for a whole CLASS of data-loss bug.
 *
 * In SQLite with `PRAGMA foreign_keys = ON`, `INSERT OR REPLACE INTO <parent>` resolves a
 * primary-key conflict by DELETING the existing parent row (firing `ON DELETE CASCADE`) and
 * re-inserting it — silently wiping every child row. This is exactly how re-saving an AI
 * conversation erased its messages (the recurring "AI-tråden är tom" bug). The correct write
 * is a true UPSERT: `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` (updates in place, no
 * delete, no cascade).
 *
 * This script fails CI if any source file does `INSERT OR REPLACE INTO <table>` where <table>
 * is the parent of an `ON DELETE CASCADE` foreign key anywhere in the codebase.
 *
 * Exit 0 = clean. Exit 1 = a dangerous replace was found.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', 'coverage', 'out', 'renderer']);

/** Recursively collect .ts/.tsx/.js/.sql source files. */
function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) {
      if (name === '__tests__' || name === 'docs') continue; // tests/docs may describe the bug
      yield* sources(p);
      continue;
    }
    if (/\.(test|spec)\.[tj]sx?$/.test(name)) continue; // test files legitimately mention the pattern
    if (['.ts', '.tsx', '.js', '.mjs', '.sql'].includes(extname(name))) yield p;
  }
}

const files = [...sources(root)];

// 1) Find every table that is the PARENT of an ON DELETE CASCADE foreign key.
const cascadeParents = new Set();
const fkRe = /FOREIGN\s+KEY\s*\([^)]*\)\s*REFERENCES\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*ON\s+DELETE\s+CASCADE/gi;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = fkRe.exec(src))) cascadeParents.add(m[1]);
}

// 2) Flag any INSERT OR REPLACE INTO one of those parent tables.
const violations = [];
const replaceRe = /INSERT\s+OR\s+REPLACE\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  let m;
  while ((m = replaceRe.exec(src))) {
    const table = m[1];
    if (cascadeParents.has(table)) {
      const line = src.slice(0, m.index).split('\n').length;
      violations.push({ file: f.replace(root + '/', ''), line, table });
    }
  }
}

if (cascadeParents.size === 0) {
  console.log('check-sql-cascade-replace: no ON DELETE CASCADE foreign keys found (nothing to guard).');
}

if (violations.length > 0) {
  console.error('\n✖ Dangerous `INSERT OR REPLACE` into a CASCADE-parent table (will wipe child rows):');
  for (const v of violations) {
    console.error(`   ${v.file}:${v.line} — INSERT OR REPLACE INTO ${v.table} (parent of an ON DELETE CASCADE FK)`);
  }
  console.error('\n   Use a true upsert instead: INSERT ... ON CONFLICT(id) DO UPDATE SET ...');
  console.error('   (delete+insert fires the cascade; update-in-place does not).\n');
  process.exit(1);
}

console.log(`check-sql-cascade-replace: OK — ${cascadeParents.size} cascade-parent table(s) [${[...cascadeParents].join(', ')}], no unsafe INSERT OR REPLACE.`);
