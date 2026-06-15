/**
 * Fail fast if package-lock.json is out of sync with the workspace package.json
 * files. CI runs a strict `npm ci`, which ABORTS on any lockfile↔package.json
 * drift — and an out-of-sync lock also breaks the EAS "Install dependencies" phase
 * and the Docker (npm 10) web/backend build. This was a real, repeated CI-failure
 * source (a `--package-lock-only` regen left the lock hundreds of lines short).
 *
 * Strategy: snapshot the lockfile, run `npm install --package-lock-only` (resolves
 * the lock from package.json WITHOUT installing), and compare. If it changed, the
 * committed lock didn't match — restore the snapshot and fail with a clear fix.
 * Non-destructive: the lockfile is always left exactly as it was found.
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const lockPath = path.join(process.cwd(), 'package-lock.json');

let before;
try {
  before = readFileSync(lockPath, 'utf8');
} catch {
  console.error('check-lockfile: package-lock.json not found at repo root.');
  process.exit(1);
}

try {
  // npm 10 to match CI/Docker; --ignore-scripts so no native builds run here.
  execSync('npx --yes npm@10 install --package-lock-only --no-audit --no-fund --ignore-scripts', {
    stdio: 'ignore',
  });
} catch (e) {
  console.error('check-lockfile: failed to resolve lockfile —', e?.message || e);
  // Restore just in case npm mutated it before erroring.
  writeFileSync(lockPath, before);
  process.exit(1);
}

const after = readFileSync(lockPath, 'utf8');
if (after !== before) {
  writeFileSync(lockPath, before); // restore — never leave the tree dirty
  console.error(
    '\n✗ package-lock.json is OUT OF SYNC with package.json.\n' +
      '  CI `npm ci`, the EAS build and the Docker deploy all reject this.\n' +
      '  Fix: run `npm install` (npm 10) at noter-app/, commit the updated\n' +
      '  package-lock.json, and re-push. Never use `--package-lock-only` alone.\n',
  );
  process.exit(1);
}

console.log('✓ package-lock.json is in sync with package.json.');
