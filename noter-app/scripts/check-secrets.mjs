/**
 * Mechanical secret-scanning guard: fail CI if a credential or an env file is committed.
 *
 * Catches the classes that have actually bitten this repo (a hardcoded deploy password, a stray
 * .env.bak) plus the high-signal token formats. Deliberately conservative — only high-confidence
 * patterns — so it never goes red on a false positive and erodes trust. Scans TRACKED files only
 * (git ls-files), since that is what would actually leak.
 *
 * Run:  node scripts/check-secrets.mjs            (scan)
 *       node scripts/check-secrets.mjs --selftest (verify the patterns detect + don't false-positive)
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SELFTEST = process.argv.includes('--selftest');

// --- High-confidence credential patterns (structural — near-zero false positives) -----------------
const STRUCTURAL = [
  { re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, what: 'private key block' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, what: 'AWS access key id' },
  { re: /\bASIA[0-9A-Z]{16}\b/, what: 'AWS temporary access key id' },
  { re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/, what: 'Slack token' },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36,}/, what: 'GitHub token' },
  { re: /\bgithub_pat_[0-9A-Za-z_]{60,}/, what: 'GitHub fine-grained PAT' },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, what: 'Google API key' },
  { re: /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/, what: 'Stripe live secret key' },
  { re: /\bsk-[A-Za-z0-9]{32,}\b/, what: 'OpenAI-style secret key' },
];

// --- Hardcoded credential LITERAL (assignment to a quoted constant) --------------------------------
// e.g.  password = "hunter2"   secret: 'abc123'.  Excludes env reads ($..., ${...}, process.env, os.environ)
// and obvious placeholders. Skipped in tests/docs (fixtures + examples legitimately carry fake creds).
const CRED_LITERAL = /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key)\b\s*[:=]\s*(['"])([^'"]{5,})\1/i;
const PLACEHOLDER = /(example|changeme|change-me|your[-_]|placeholder|redact|dummy|xxxx|<.*>|\.\.\.|test|sample|fake|todo|none|null|undefined|process\.env|os\.environ)/i;
const ENV_INTERP = /^[$%]\{?|^\$[A-Z]/; // $VAR, ${VAR}, %VAR%

const isTestOrDoc = (p) => /(^|[\\/])(__tests__|tests|__fixtures__|fixtures|e2e|cypress)[\\/]|\.(test|spec|cy)\.[tj]sx?$|\.(md|mdx|snap)$/.test(p);
// An env file that should never be committed (the .example/.sample templates are fine).
const isCommittedEnvFile = (p) => /(^|[\\/])\.env(\.[A-Za-z0-9]+)*$/.test(p) && !/\.(example|sample|template)$/.test(p);

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp4|mov|wasm|node|keystore|jks|p12|enc)$/i;
const SKIP_PATH = /(^|[\\/])(node_modules|dist|\.next|\.turbo|out|coverage|\.git|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)([\\/]|$)/;

// Allowlist of findings known to be safe (keep tiny + justified). Format: substring match on `${file}:${what}`.
const ALLOWLIST = [
  // Dev-only sync verification script: registers a THROWAWAY test user with a throwaway password.
  'apps/mobile/verify-sync.js:hardcoded credential literal',
];

// Scan the WHOLE repo (the git root is the parent of noter-app/), so root-level files like
// docker-compose.yml + deploy scripts are covered, not just the app workspace.
const repoRoot = (() => {
  try { return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
})();

const trackedFiles = () => {
  try {
    return execSync('git ls-files', { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
};

const scanFile = (rel, baseDir = repoRoot) => {
  const findings = [];
  if (isCommittedEnvFile(rel)) findings.push({ file: rel, line: 0, what: 'committed .env file (add to .gitignore / use .env.example)' });
  if (BINARY_EXT.test(rel) || SKIP_PATH.test(rel)) return findings;
  // Tests/docs reference key FORMATS (regex matchers) and carry fake fixtures — scanning their content
  // is almost all false positives, and they never deploy. The committed-env-file check above still ran.
  if (isTestOrDoc(rel)) return findings;
  const isI18nLabels = /(^|[\\/])i18n\.[tj]sx?$/.test(rel); // translation strings (e.g. password: 'Password')
  let text;
  try {
    const abs = path.isAbsolute(rel) ? rel : path.join(baseDir, rel);
    const stat = fs.statSync(abs);
    if (stat.size > 2 * 1024 * 1024) return findings; // skip huge files
    text = fs.readFileSync(abs, 'utf8');
  } catch { return findings; }

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const { re, what } of STRUCTURAL) {
      if (re.test(line)) findings.push({ file: rel, line: i + 1, what });
    }
    if (!isI18nLabels) {
      const m = CRED_LITERAL.exec(line);
      if (m) {
        const val = m[2];
        // Only a SECRET-looking value: no whitespace + has a digit or a symbol. This skips UI labels
        // ('Password', 'Lösenord', 'Enter password') while still catching '12345678', 'p@ss', etc.
        const looksSecret = !/\s/.test(val) && (/[0-9]/.test(val) || /[!@#$%^&*_+=?]/.test(val));
        if (looksSecret && !PLACEHOLDER.test(val) && !ENV_INTERP.test(val)) {
          findings.push({ file: rel, line: i + 1, what: `hardcoded credential literal (${m[0].split(/[:=]/)[0].trim()})` });
        }
      }
    }
  }
  return findings;
};

const runScan = () => {
  const all = [];
  for (const f of trackedFiles()) {
    for (const find of scanFile(f)) {
      if (!ALLOWLIST.some((a) => `${find.file}:${find.what}`.includes(a))) all.push(find);
    }
  }
  return all;
};

if (SELFTEST) {
  const tmp = path.join(process.cwd(), '.secrets-selftest-tmp');
  fs.mkdirSync(tmp, { recursive: true });
  const planted = path.join(tmp, 'planted.txt');
  // A planted credential MUST be detected; a placeholder + an env read MUST NOT be.
  fs.writeFileSync(planted, [
    'aws = "AKIAIOSFODNN7EXAMPLE"',
    'password = "s3cr3t-real-value"',
    'password = "changeme-example"',     // placeholder → not a finding
    'password = process.env.PI_PASSWORD',// env read → not a finding
  ].join('\n'));
  const found = scanFile(path.relative(process.cwd(), planted), process.cwd());
  fs.rmSync(tmp, { recursive: true, force: true });
  const kinds = found.map((f) => f.what).join('|');
  const okAws = /AWS access key/.test(kinds);
  const okCred = /hardcoded credential/.test(kinds);
  const noFalsePos = found.length === 2;
  if (okAws && okCred && noFalsePos) {
    console.log('check-secrets --selftest: OK (detects AWS key + hardcoded literal; ignores placeholder + env read).');
    process.exit(0);
  }
  console.error(`check-secrets --selftest: FAILED (aws=${okAws} cred=${okCred} count=${found.length}, expected 2).`);
  process.exit(1);
}

const findings = runScan();
if (findings.length === 0) {
  console.log('check-secrets: OK (no committed credentials or env files detected).');
  process.exit(0);
}
console.error('check-secrets: potential secrets committed —\n');
for (const f of findings) console.error(`  ${f.file}${f.line ? ':' + f.line : ''} — ${f.what}`);
console.error('\nRemove the secret, rotate it, and read it from the environment instead. If this is a false positive, add it to ALLOWLIST in scripts/check-secrets.mjs with a justification.');
process.exit(1);
