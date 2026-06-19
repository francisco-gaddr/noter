import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

const steps = [
  {
    // Lockfile drift breaks CI `npm ci`, the EAS install phase, and the Docker
    // deploy. Catch it here so a bad lock never reaches a push (no CI-failure mail).
    label: 'Lockfile in sync with package.json',
    cwd: repoRoot,
    command: 'node',
    args: ['scripts/check-lockfile.mjs'],
  },
  {
    // Fail fast if any dead (unimported) source file sneaks in.
    label: 'No dead files (knip)',
    cwd: repoRoot,
    command: 'npm',
    args: ['run', 'knip:files'],
  },
  {
    // Mechanical IDOR guard: no unscoped findById(req.params...) in routes.
    label: 'Route-scoping guard (IDOR / CWE-639)',
    cwd: repoRoot,
    command: 'node',
    args: ['scripts/check-route-scoping.mjs'],
  },
  {
    // Mechanical guard for the data-loss CLASS behind the recurring empty-AI-thread bug:
    // INSERT OR REPLACE into a table that is the parent of an ON DELETE CASCADE FK silently
    // wipes its children. Must use ON CONFLICT DO UPDATE instead.
    label: 'SQL cascade-replace guard (no message-wiping upserts)',
    cwd: repoRoot,
    command: 'node',
    args: ['scripts/check-sql-cascade-replace.mjs'],
  },
  {
    // Hard locked-folder invariant: a locked note/folder must never leak into an external
    // publish surface or a persistent index. Fails if the UI unlock set is fed into a
    // calendar/markdown-share projection, the Neo4j graph sync, or the embeddings index.
    label: 'Locked-content leak guard (no UI unlock set into index/publish)',
    cwd: repoRoot,
    command: 'node',
    args: ['scripts/check-index-unlock-leak.mjs'],
  },
  {
    // Guard-of-the-guard: prove the leak detector actually catches the leak class it exists
    // for (and raises no false positives), so it can never silently rot into a no-op.
    label: 'Locked-content leak guard self-test',
    cwd: repoRoot,
    command: 'node',
    args: ['scripts/check-index-unlock-leak.mjs', '--selftest'],
  },
  {
    // Invariant: ENCRYPTION goes only through @repo/shared. Fails if an app/backend file
    // reaches for the E2E cipher (@noble/ciphers / CryptoJS.AES) directly.
    label: 'Crypto-boundary guard (encryption only via @repo/shared)',
    cwd: repoRoot,
    command: 'node',
    args: ['scripts/check-crypto-boundary.mjs'],
  },
  {
    label: 'Crypto-boundary guard self-test',
    cwd: repoRoot,
    command: 'node',
    args: ['scripts/check-crypto-boundary.mjs', '--selftest'],
  },
  {
    // Shared is the crypto/widget foundation — gate it first so a broken
    // encrypt/cryptoV3/widgetData can't reach any app.
    label: 'Shared package tests (crypto, widgets, key bootstrap)',
    cwd: path.join(repoRoot, 'packages', 'shared'),
    command: 'npm',
    args: ['run', 'test'],
  },
  {
    // The Docker deploy runs `@repo/shared build` (tsc) inside `npm ci`; a broken
    // shared build fails EVERY app image build on the Pi. jest uses babel and won't
    // catch tsc errors, so gate the real build here too (caught a test-file type
    // error that silently broke auto-deploy on 2026-06-14).
    label: 'Shared package build (tsc — deploy gate)',
    cwd: path.join(repoRoot, 'packages', 'shared'),
    command: 'npm',
    args: ['run', 'build'],
  },
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
      '__tests__/utils/encryption.test.ts',
      '__tests__/utils/cors-origins.test.ts',
      '__tests__/utils/validateEnv.test.ts',
      '__tests__/caldav.test.ts',
      '__tests__/markdav.test.ts',
      '__tests__/neo4j-relay.test.ts',
      '__tests__/routes/keyBundle.test.ts',
      '__tests__/routes/apiKeys.test.ts',
      '__tests__/routes/ownership-isolation.test.ts',
      '__tests__/routes/ai-sync-isolation.test.ts',
      '__tests__/routes/admin-overview.test.ts',
      '__tests__/health-deep.test.ts',
      '__tests__/ai-sync.test.ts',
      '__tests__/graphql-tools.test.ts',
      '__tests__/notes-lock-security.test.ts',
      '__tests__/notes-lock.test.ts',
      '__tests__/request-security.test.ts',
      '__tests__/api-hardening.test.ts',
      '__tests__/api-key-mint.test.ts',
      '__tests__/middleware/apiKeyAuth.test.ts',
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
      '__tests__/ai-streaming.test.ts',
      '__tests__/e2e-encryption.test.ts',
      '__tests__/task-encryption.test.ts',
      '__tests__/mcp-settings.test.ts',
      '__tests__/video-embed-e2e.test.ts',
      '__tests__/web-crypto.test.ts',
      '__tests__/contrast-guard.test.ts',
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
      // NOTE: notes-header / notes-sort-persistence / task-settings-persistence render full screens
      // that import services/api, whose `Platform.select` runs before jest-expo initialises RN — so
      // those 3 suites fail to LOAD (pre-existing jest-infra flake, reproduces on old commits too).
      // Tracked in the non-blocking backlog (#12). Excluded from the blocking gate until the jest-expo
      // setup is fixed, so a real product regression is never masked by an env flake.
      'tests/ai-chat.test.ts',
      'tests/ai-e2e.test.ts',
      'tests/ai-tool-use-e2e.test.ts',
      'tests/ai-security.test.ts',
      'tests/ai-sync-service.test.ts',
      // BLOCKING: real-SQLite proof that re-saving a conversation never wipes its messages
      // (THE root cause of the recurring "AI-tråden är tom trots text" bug).
      '__tests__/database-conversation-cascade.test.ts',
      // BLOCKING: model search/picker helpers never throw on malformed data.
      '__tests__/ai-model-safety.test.ts',
      'tests/api-url-security.test.ts',
      'tests/api-auth-reliability.test.ts',
      'tests/database-at-rest.test.ts',
      'tests/notifications-e2e.test.ts',
      'tests/reminder-defaults.test.ts',
      'tests/api-providers.test.ts',
      'tests/ai-attachments.test.ts',
      'tests/usage-tracker.test.ts',
      'tests/sse-parser.test.ts',
      'tests/widget-snapshot-writer.test.ts',
      'tests/thinking.test.ts',
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
    // The Electron app lives in a sibling repo that is NOT checked out in CI (only
    // noter-app is). Skip gracefully there; run it locally where the dir exists.
    skipIfMissingCwd: true,
  },
];

for (const step of steps) {
  if (step.skipIfMissingCwd && !existsSync(step.cwd)) {
    console.log(`\n=== ${step.label} ===`);
    console.log(`(skipped — ${step.cwd} not present in this checkout)`);
    continue;
  }
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
