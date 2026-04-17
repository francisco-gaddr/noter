const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const webDir = path.join(__dirname, '..', '..', 'noter-app', 'apps', 'web');
const noterAppRoot = path.join(__dirname, '..', '..', 'noter-app');
const standaloneDir = path.join(webDir, '.next', 'standalone');
const standaloneServerPath = path.join(standaloneDir, 'apps', 'web', 'server.js');
const standaloneStaticDir = path.join(webDir, '.next', 'static');
const publicDir = path.join(webDir, 'public');
const rendererStandaloneDir = path.join(__dirname, '..', 'renderer-standalone');

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { 
    cwd: webDir,
    stdio: 'inherit', 
    shell: true,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192', ELECTRON_STANDALONE: '1' }
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

const runInNoterApp = (args) => {
  const result = spawnSync('npm', args, {
    cwd: noterAppRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

runInNoterApp(['run', 'build', '--workspace=packages/shared']);
runInNoterApp(['run', 'build', '--workspace=packages/ai']);
run('npm', ['run', 'build']);
if (fs.existsSync(standaloneDir) && fs.existsSync(standaloneServerPath)) {
  if (fs.existsSync(rendererStandaloneDir)) {
    fs.rmSync(rendererStandaloneDir, { recursive: true, force: true });
  }
  fs.mkdirSync(rendererStandaloneDir, { recursive: true });
  fs.cpSync(standaloneDir, rendererStandaloneDir, { recursive: true });
  if (fs.existsSync(standaloneStaticDir)) {
    fs.mkdirSync(path.join(rendererStandaloneDir, 'apps', 'web', '.next'), { recursive: true });
    fs.cpSync(standaloneStaticDir, path.join(rendererStandaloneDir, 'apps', 'web', '.next', 'static'), { recursive: true });
  }
  if (fs.existsSync(publicDir)) {
    fs.cpSync(publicDir, path.join(rendererStandaloneDir, 'apps', 'web', 'public'), { recursive: true });
  }
} else {
  console.error('Electron-standalone-renderer saknas eller är ofullständig eftersom web/.next/standalone/apps/web/server.js inte genererades');
  process.exit(1);
}
