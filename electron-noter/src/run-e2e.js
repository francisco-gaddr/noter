const { spawnSync } = require('child_process');

const args = ['playwright', 'test'];
if (process.env.E2E_EXTENDED !== '1') {
  args.push('--grep-invert', '\\[extended\\]');
}

const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(npxCmd, args, {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    E2E_ELECTRON: '1',
    E2E_UI: typeof process.env.E2E_UI === 'string' ? process.env.E2E_UI : '1',
  },
});

process.exit(typeof result.status === 'number' ? result.status : 1);
