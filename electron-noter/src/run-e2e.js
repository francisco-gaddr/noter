const { spawnSync } = require('child_process');

const result = spawnSync('npx', ['playwright', 'test'], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    E2E_ELECTRON: '1',
  },
});

process.exit(typeof result.status === 'number' ? result.status : 1);
