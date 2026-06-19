/**
 * Mechanical guard for the invariant: ENCRYPTION/DECRYPTION happens ONLY via @repo/shared.
 *
 * The E2E cipher (@noble/ciphers AES-GCM) and crypto-js symmetric encryption (`CryptoJS.AES`)
 * must live exclusively in `packages/shared` (encrypt.ts / cryptoV3.ts). An app or backend file
 * that reaches for them directly is hand-rolling content crypto outside the audited, single-key
 * boundary — exactly what "krypto endast via @repo/shared" forbids, and a path to a plaintext or
 * wrong-key leak. SHA-256 hashing via crypto-js (lock-password compare, content-change dedup) is
 * NOT confidentiality crypto and is allowed anywhere.
 *
 * Production code only — test/fixture files may construct ciphertext for setup.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Encryption signals that must NOT appear outside packages/shared.
const FORBIDDEN = [
  { re: /from\s+['"]@noble\/ciphers/, what: "import of @noble/ciphers (the E2E AES-GCM cipher)" },
  { re: /require\(\s*['"]@noble\/ciphers/, what: "require of @noble/ciphers (the E2E AES-GCM cipher)" },
  { re: /\bCryptoJS\.AES\b/, what: 'CryptoJS.AES (crypto-js symmetric encryption)' },
  { re: /from\s+['"]crypto-js\/aes['"]/, what: "import of crypto-js/aes" },
];

const SHARED_DIR = path.join('packages', 'shared') + path.sep;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'out', 'coverage', '.git']);
const isTestFile = (p) => /(^|[\\/])(__tests__|tests|cypress)[\\/]|\.(test|spec|cy)\.[tj]sx?$/.test(p);

function walk(dir, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Returns `repo-relative:line — message` strings for every encryption-outside-shared hit. */
export function findCryptoBoundaryViolations(root) {
  const offenders = [];
  const roots = ['apps', 'packages'].map((d) => path.join(root, d)).filter((d) => fs.existsSync(d));
  for (const file of roots.flatMap((r) => walk(r, []))) {
    const rel = path.relative(root, file);
    if (rel.startsWith(SHARED_DIR)) continue; // the one place E2E crypto may live
    if (isTestFile(rel)) continue; // test fixtures may build ciphertext
    const src = fs.readFileSync(file, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      for (const { re, what } of FORBIDDEN) {
        if (re.test(lines[i])) offenders.push(`${rel}:${i + 1} — ${what}`);
      }
    }
  }
  return offenders;
}

/** Prove the guard catches encryption-outside-shared AND ignores SHA-256 hashing + the shared dir. */
function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-boundary-selftest-'));
  const fails = [];
  try {
    // 1) Encryption in an app file MUST be flagged.
    const appDir = path.join(dir, 'bad', 'apps');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'enc.ts'), "import { gcm } from '@noble/ciphers/aes';\nconst x = CryptoJS.AES.encrypt(a, b);\n");
    if (findCryptoBoundaryViolations(path.join(dir, 'bad')).length < 2) fails.push('guard missed encryption outside shared');
    // 2) SHA-256 hashing must NOT be flagged.
    const okDir = path.join(dir, 'ok', 'apps');
    fs.mkdirSync(okDir, { recursive: true });
    fs.writeFileSync(path.join(okDir, 'hash.ts'), "import CryptoJS from 'crypto-js';\nexport const h = (s) => CryptoJS.SHA256(s).toString();\n");
    if (findCryptoBoundaryViolations(path.join(dir, 'ok')).length !== 0) fails.push('guard false-positived on SHA-256 hashing');
    // 3) Encryption INSIDE packages/shared must NOT be flagged.
    const sharedDir = path.join(dir, 'shared', 'packages', 'shared', 'src');
    fs.mkdirSync(sharedDir, { recursive: true });
    fs.writeFileSync(path.join(sharedDir, 'encrypt.ts'), "import { gcm } from '@noble/ciphers/aes';\n");
    if (findCryptoBoundaryViolations(path.join(dir, 'shared')).length !== 0) fails.push('guard false-positived on packages/shared');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (fails.length) {
    console.error('check-crypto-boundary --selftest FAILED:');
    for (const f of fails) console.error('  ✗ ' + f);
    process.exit(1);
  }
  console.log('check-crypto-boundary --selftest: OK (flags encryption outside shared; ignores SHA-256 + the shared dir).');
}

function main() {
  if (process.argv.includes('--selftest')) { selftest(); return; }
  const offenders = findCryptoBoundaryViolations(process.cwd());
  if (offenders.length) {
    console.error('Crypto-boundary guard FAILED — encryption/decryption must go ONLY through @repo/shared:\n');
    for (const o of offenders) console.error('  ✗ ' + o);
    console.error('\nFix: use encrypt()/decrypt()/cryptoV3 from @repo/shared instead of a direct cipher.');
    process.exit(1);
  }
  console.log('Crypto-boundary guard: OK (no encryption outside @repo/shared).');
}

main();
