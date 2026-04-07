import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(process.cwd(), '..');

const gitResult = spawnSync('git', ['ls-files'], {
  cwd: repoRoot,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

if (gitResult.status !== 0) {
  console.error('Kunde inte läsa spårade filer med git ls-files.');
  process.exit(gitResult.status ?? 1);
}

const trackedFiles = gitResult.stdout
  .split(/\r?\n/)
  .map((value) => value.trim())
  .filter(Boolean);

const localAssistantBasenames = [
  'AGENTS',
  'agent',
  'INSTRUCTIONS',
  'RULES_INDEX',
  'CLAUDE',
  'GEMINI',
  'COPILOT',
  'CURSOR',
  'WINDSURF',
  'AIDER',
];

const trackedAssistantChecks = [
  { label: 'lokal Trae-konfiguration', pattern: /(^|[\\/])\.trae([\\/]|$)/i },
  { label: 'lokal Trae-konfiguration', pattern: /(^|[\\/])\.trae-local([\\/]|$)/i },
  { label: 'lokal Trae-dokumentation', pattern: /(^|[\\/])\.trae-docs([\\/]|$)/i },
  { label: 'lokal assistantkatalog', pattern: /(^|[\\/])\.(claude|gemini|copilot)([\\/]|$)/i },
  { label: 'lokal assistantfil', pattern: new RegExp(`(^|[\\\\/])(?:${localAssistantBasenames.join('|')})\\.md$`, 'i') },
  { label: 'lokal assistantfil', pattern: /(^|[\\/])[^\\/]+\.agent\.md$/i },
  { label: 'lokal assistantfil', pattern: /(^|[\\/])TRAE[^\\/]*\.md$/i },
  { label: 'lokal assistantfil', pattern: /(^|[\\/])[^\\/]+\.trae\.md$/i },
  { label: 'lokal assistantdata', pattern: /(^|[\\/])\.aider[^\\/]*$/i },
];

const violations = trackedFiles.flatMap((relativePath) =>
  trackedAssistantChecks
    .filter((check) => check.pattern.test(relativePath))
    .map((check) => `${relativePath}: ${check.label}`)
);

if (violations.length > 0) {
  console.error('Local assistant-guard misslyckades.\n');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log(`Local assistant-guard OK. ${trackedFiles.length} spårade filer granskade.`);
