const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const arm64 = argv.includes('--arm64');
const ready = argv.includes('--ready');
const outputDir = ready ? 'dist-electron-ready-mac-arm64' : 'dist-electron-mac-arm64';

const run = (targetOutputDir) => {
  const args = [
    'electron-builder',
    '--mac',
    'dmg',
    'zip',
    '--publish',
    'never',
    ...(arm64 ? ['--arm64'] : []),
    `--config.directories.output=${targetOutputDir}`,
  ];
  return spawnSync('npx', args, { stdio: 'inherit', shell: true });
};

const primary = run(outputDir);
if (primary.status === 0) process.exit(0);

const fallbackDir = `${outputDir}-${Date.now()}`;
console.warn(`Primary output is busy, retrying with ${fallbackDir}`);
const fallback = run(fallbackDir);
process.exit(typeof fallback.status === 'number' ? fallback.status : 1);
