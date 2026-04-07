import { readFileSync } from 'node:fs';
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

const ignoredPathFragments = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.git${path.sep}`,
  `${path.sep}.next${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}build${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}.turbo${path.sep}`,
  `${path.sep}android${path.sep}app${path.sep}build${path.sep}`,
  `${path.sep}ios${path.sep}Pods${path.sep}`,
];

const publicSecretPattern = /\b(?:NEXT_PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|PASSWORD|CLIENT_SECRET)\b/;
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
const localAiFileChecks = [
  { label: 'lokal Trae-konfiguration', pattern: /(^|[\\/])\.trae([\\/]|$)/i },
  { label: 'lokal Trae-konfiguration', pattern: /(^|[\\/])\.trae-local([\\/]|$)/i },
  { label: 'lokal Trae-dokumentation', pattern: /(^|[\\/])\.trae-docs([\\/]|$)/i },
  { label: 'lokal AI-agentfil', pattern: new RegExp(`(^|[\\\\/])(?:${localAssistantBasenames.join('|')})\\.md$`, 'i') },
  { label: 'lokal AI-agentfil', pattern: /(^|[\\/])[^\\/]+\.agent\.md$/i },
  { label: 'lokal AI-agentfil', pattern: /(^|[\\/])TRAE[^\\/]*\.md$/i },
  { label: 'lokal AI-agentfil', pattern: /(^|[\\/])[^\\/]+\.trae\.md$/i },
  { label: 'lokal AI-agentkatalog', pattern: /(^|[\\/])\.(claude|gemini|copilot)([\\/]|$)/i },
  { label: 'lokal IDE-konfiguration', pattern: /(^|[\\/])\.(vscode|idea|cursor|windsurf|continue|cline|roo|zed|fleet)([\\/]|$)/i },
  { label: 'lokal AI-assistentdata', pattern: /(^|[\\/])\.aider[^\\/]*$/i },
  { label: 'lokal miljökonfiguration', pattern: /(^|[\\/])(\.direnv([\\/]|$)|\.envrc$)/i },
  { label: 'lokal workspace-fil', pattern: /\.code-workspace$/i },
];
const bannedContentChecks = [
  { label: 'hårdkodad produktionsdomän', pattern: /daylited\.com/i },
  { label: 'publik secret-variabel', pattern: publicSecretPattern },
  { label: 'hårdkodad publik server-ip', pattern: /217\.154\.2\.108/ },
];

const violations = [];

for (const relativePath of trackedFiles) {
  for (const check of localAiFileChecks) {
    if (check.pattern.test(relativePath)) {
      violations.push(`${relativePath}: ${check.label}`);
    }
  }

  const absolutePath = path.join(repoRoot, relativePath);
  if (ignoredPathFragments.some((fragment) => absolutePath.includes(fragment))) {
    continue;
  }

  const basename = path.basename(absolutePath);
  if (/^\.env(?:\.|$)/i.test(basename) && !/\.example$/i.test(basename)) {
    violations.push(`${relativePath}: incheckad env-fil`);
    continue;
  }

  let content = '';
  try {
    content = readFileSync(absolutePath, 'utf8');
  } catch {
    continue;
  }

  for (const check of bannedContentChecks) {
    if (check.pattern.test(content)) {
      violations.push(`${relativePath}: ${check.label}`);
    }
  }
}

if (violations.length > 0) {
  console.error('Open source-sanity check misslyckades.\n');
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log(`Open source-sanity check OK. ${trackedFiles.length} spårade filer granskade.`);
