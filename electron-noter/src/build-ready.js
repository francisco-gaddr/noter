const { spawnSync } = require('child_process');

const run = (outputDir) => {
  const args = ['electron-builder', '--dir', `--config.directories.output=${outputDir}`];
  return spawnSync('npx', args, { stdio: 'inherit', shell: true });
};

const primary = run('dist-electron-ready');
if (primary.status === 0) process.exit(0);

const fallbackDir = `dist-electron-ready-${Date.now()}`;
console.warn(`Primary output is busy, retrying with ${fallbackDir}`);
const fallback = run(fallbackDir);
process.exit(typeof fallback.status === 'number' ? fallback.status : 1);
