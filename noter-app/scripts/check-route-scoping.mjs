#!/usr/bin/env node
/**
 * Mechanical IDOR guard. Fails if a backend route looks up an object by a
 * client-supplied id WITHOUT scoping by userId — the exact bug class fixed in
 * T19 (CWE-639/862). This catches the regression at CI time instead of in review.
 *
 * Heuristic: flag `Model.findById(req.params.<x>)` and the
 * `findByIdAndUpdate/Delete` variants in apps/backend/src/routes/*. These MUST be
 * `findOne({ _id: ..., userId })` (or an explicitly allowlisted self-scoped lookup).
 *
 * Allowlist: lookups where the id IS the authenticated user (e.g. keyBundle's
 * `User.findById(userId)`) are safe — list them below with a reason.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const routesDir = path.join(repoRoot, 'apps', 'backend', 'src', 'routes');

// file:line fragments that are reviewed-safe (self-scoped by the auth'd user).
const ALLOWLIST = [
  // keyBundle: the id IS req.user.userId, so it is inherently scoped.
  'User.findById(userId)',
  'User.findByIdAndUpdate(',
];

// Matches findById / findByIdAndUpdate / findByIdAndDelete used with req.params.
const RISKY = /\.(findById|findByIdAndUpdate|findByIdAndDelete)\s*\(\s*req\.params/;

const walk = (dir) => {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files = files.concat(walk(full));
    else if (full.endsWith('.ts') && !full.endsWith('.test.ts')) files.push(full);
  }
  return files;
};

const offenders = [];
for (const file of walk(routesDir)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!RISKY.test(line)) return;
    if (ALLOWLIST.some((a) => line.includes(a))) return;
    offenders.push(`${path.relative(repoRoot, file)}:${i + 1}  ${line.trim()}`);
  });
}

if (offenders.length > 0) {
  console.error('\n✖ Route-scoping guard: unscoped by-id lookup(s) found (IDOR risk, CWE-639).');
  console.error('  Use findOne({ _id: req.params.x, userId }) instead of findById(req.params.x).');
  console.error('  If this is genuinely self-scoped (id === auth user), add it to the ALLOWLIST.\n');
  for (const o of offenders) console.error('   ' + o);
  console.error('');
  process.exit(1);
}

console.log('✓ Route-scoping guard: all by-id route lookups are userId-scoped.');
