import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const electronRoot = path.resolve(repoRoot, '..', 'electron-noter');

const mutationCases = [
  {
    label: 'Backend URL-längdskydd',
    cwd: path.join(repoRoot, 'apps', 'backend'),
    filePath: path.join(repoRoot, 'apps', 'backend', 'src', 'middleware', 'requestSecurity.ts'),
    searchRegex: /  if \(\(req\.originalUrl \|\| ''\)\.length > 2048\) \{\r?\n    return res\.status\(414\)\.json\(\{ message: 'Request URL is too long' \}\);\r?\n  \}/,
    replace: "  if (false) {\n    return res.status(414).json({ message: 'Request URL is too long' });\n  }",
    args: ['run', 'test', '--', '__tests__/request-security.test.ts'],
  },
  {
    label: 'Backend injektionsfilter',
    cwd: path.join(repoRoot, 'apps', 'backend'),
    filePath: path.join(repoRoot, 'apps', 'backend', 'src', 'middleware', 'requestSecurity.ts'),
    search: '  if (hasDangerousUrlPattern(req.originalUrl)) {',
    replace: '  if (false) {',
    args: ['run', 'test', '--', '__tests__/request-security.test.ts', '__tests__/api-hardening.test.ts'],
  },
  {
    label: 'Mobil HTTPS-policy',
    cwd: path.join(repoRoot, 'apps', 'mobile'),
    filePath: path.join(repoRoot, 'apps', 'mobile', 'services', 'api.ts'),
    search: "  if (!runtimeDevMode && protocol === 'http:' && !isLocalHost) {",
    replace: "  if (false) {",
    args: ['run', 'test', '--', 'tests/api-url-security.test.ts'],
  },
  {
    label: 'Mobil sync-kryptering',
    cwd: path.join(repoRoot, 'apps', 'mobile'),
    filePath: path.join(repoRoot, 'apps', 'mobile', 'services', 'database.ts'),
    search: '  const encryptedData = encrypt(JSON.stringify(data));',
    replace: '  const encryptedData = JSON.stringify(data);',
    args: ['run', 'test', '--', 'tests/database-at-rest.test.ts'],
  },
  {
    label: 'Electron extern URL-policy',
    cwd: electronRoot,
    filePath: path.join(electronRoot, 'main.js'),
    search: "const allowedExternalProtocols = new Set(['https:', 'http:']);",
    replace: "const allowedExternalProtocols = new Set(['https:', 'http:', 'file:']);",
    args: ['run', 'test', '--', 'tests/release-readiness.test.js'],
  },
  {
    label: 'Electron krypterad settings-fallback',
    cwd: electronRoot,
    filePath: path.join(electronRoot, 'main.js'),
    search: '  return Boolean(safeStorage?.isEncryptionAvailable?.());',
    replace: '  return false;',
    args: ['run', 'test', '--', 'tests/release-readiness.test.js'],
  },
];

const runStep = ({ cwd, args }) => {
  const result = spawnSync('npm', args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status ?? 1;
};

for (const mutationCase of mutationCases) {
  const original = fs.readFileSync(mutationCase.filePath, 'utf8');
  const hasStringTarget = typeof mutationCase.search === 'string' && original.includes(mutationCase.search);
  const hasRegexTarget = mutationCase.searchRegex instanceof RegExp && mutationCase.searchRegex.test(original);
  if (!hasStringTarget && !hasRegexTarget) {
    throw new Error(`Kunde inte hitta mutationsmål för ${mutationCase.label}`);
  }

  const mutated =
    typeof mutationCase.search === 'string'
      ? original.replace(mutationCase.search, mutationCase.replace)
      : original.replace(mutationCase.searchRegex, mutationCase.replace);
  if (mutated === original) {
    throw new Error(`Mutation gav ingen kodändring för ${mutationCase.label}`);
  }

  fs.writeFileSync(mutationCase.filePath, mutated);
  try {
    console.log(`\n=== Mutation: ${mutationCase.label} ===`);
    const status = runStep(mutationCase);
    if (status === 0) {
      throw new Error(`Mutant överlevde: ${mutationCase.label}`);
    }
    console.log(`Mutant dödad: ${mutationCase.label}`);
  } finally {
    fs.writeFileSync(mutationCase.filePath, original);
  }
}

console.log('\nAlla säkerhetsmutanter dödades.');
