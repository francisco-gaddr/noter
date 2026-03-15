import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

const steps = [
  {
    label: 'Backend critical unit/integration/security',
    cwd: path.join(repoRoot, 'apps', 'backend'),
    command: 'npm',
    args: [
      'run',
      'test',
      '--',
      '__tests__/api.test.ts',
      '__tests__/encryption-validation.test.ts',
      '__tests__/ai-sync.test.ts',
      '__tests__/graphql-tools.test.ts',
      '__tests__/notes-lock-security.test.ts',
      '__tests__/request-security.test.ts',
      '__tests__/api-hardening.test.ts',
      '__tests__/mcp-runtime.test.ts',
      '__tests__/mcp-routes.test.ts',
    ],
  },
  {
    label: 'Backend typecheck',
    cwd: path.join(repoRoot, 'apps', 'backend'),
    command: 'npm',
    args: ['run', 'check-types'],
  },
  {
    label: 'Web critical unit/e2e/security',
    cwd: path.join(repoRoot, 'apps', 'web'),
    command: 'npm',
    args: [
      'run',
      'test',
      '--',
      '__tests__/store.test.ts',
      '__tests__/SidebarTree.test.tsx',
      '__tests__/sidebar-project-dropdown.e2e.test.tsx',
      '__tests__/ai-security.test.ts',
      '__tests__/ai-sync-service.test.ts',
      '__tests__/e2e-encryption.test.ts',
      '__tests__/task-encryption.test.ts',
      '__tests__/mcp-settings.test.ts',
      '__tests__/video-embed-e2e.test.ts',
    ],
  },
  {
    label: 'Web typecheck',
    cwd: path.join(repoRoot, 'apps', 'web'),
    command: 'npm',
    args: ['run', 'check-types'],
  },
  {
    label: 'Mobile critical unit/e2e/security',
    cwd: path.join(repoRoot, 'apps', 'mobile'),
    command: 'npm',
    args: [
      'run',
      'test',
      '--',
      '__tests__/store.test.ts',
      'tests/notes-header.test.tsx',
      'tests/notes-sort-persistence.e2e.test.tsx',
      'tests/task-settings-persistence.e2e.test.tsx',
      'tests/ai-chat.test.ts',
      'tests/ai-e2e.test.ts',
      'tests/ai-tool-use-e2e.test.ts',
      'tests/ai-security.test.ts',
      'tests/ai-sync-service.test.ts',
      'tests/api-url-security.test.ts',
      'tests/api-auth-reliability.test.ts',
      'tests/database-at-rest.test.ts',
      'tests/notifications-e2e.test.ts',
      'tests/reminder-defaults.test.ts',
    ],
  },
  {
    label: 'Mobile typecheck',
    cwd: path.join(repoRoot, 'apps', 'mobile'),
    command: 'npm',
    args: ['run', 'check-types'],
  },
  {
    label: 'Electron critical tests',
    cwd: path.resolve(repoRoot, '..', 'electron-noter'),
    command: 'npm',
    args: ['run', 'test'],
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
    console.error(`\nValidation failed at: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log('\nAll critical validation steps passed.');
