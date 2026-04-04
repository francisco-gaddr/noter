import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

const steps = [
  {
    label: 'Backend säkerhetstester',
    cwd: path.join(repoRoot, 'apps', 'backend'),
    command: 'npm',
    args: [
      'run',
      'test',
      '--',
      '__tests__/request-security.test.ts',
      '__tests__/api-hardening.test.ts',
      '__tests__/auth-middleware.test.ts',
      '__tests__/notes-lock-security.test.ts',
      '__tests__/encryption-validation.test.ts',
    ],
  },
  {
    label: 'Backend typecheck',
    cwd: path.join(repoRoot, 'apps', 'backend'),
    command: 'npm',
    args: ['run', 'check-types'],
  },
  {
    label: 'Mobil säkerhetstester',
    cwd: path.join(repoRoot, 'apps', 'mobile'),
    command: 'npm',
    args: [
      'run',
      'test',
      '--',
      'tests/api-auth-reliability.test.ts',
      'tests/api-url-security.test.ts',
      'tests/database-at-rest.test.ts',
      'tests/app-lock-expo-go.test.tsx',
      'tests/ai-security.test.ts',
      'tests/encryption-key-init.test.ts',
      '__tests__/e2e-encryption.test.ts',
      '__tests__/task-encryption.test.ts',
    ],
  },
  {
    label: 'Mobil typecheck',
    cwd: path.join(repoRoot, 'apps', 'mobile'),
    command: 'npm',
    args: ['run', 'check-types'],
  },
  {
    label: 'Web säkerhetstester',
    cwd: path.join(repoRoot, 'apps', 'web'),
    command: 'npm',
    args: [
      'run',
      'test',
      '--',
      '__tests__/ai-security.test.ts',
      '__tests__/e2e-encryption.test.ts',
      '__tests__/task-encryption.test.ts',
    ],
  },
  {
    label: 'Electron säkerhetstester',
    cwd: path.resolve(repoRoot, '..', 'electron-noter'),
    command: 'npm',
    args: ['run', 'test', '--', 'tests/release-readiness.test.js', 'tests/preload-security.test.js'],
  },
  {
    label: 'Open source repo-scan',
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'test:repo:open-source'],
  },
  {
    label: 'Mutationssvit',
    cwd: repoRoot,
    command: 'node',
    args: ['scripts/security-mutation-suite.mjs'],
  },
];

for (const step of steps) {
  console.log(`\n=== ${step.label} ===`);
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`\nSäkerhetssviten stoppade vid: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nSäkerhets- och mutationssviten passerade.');
