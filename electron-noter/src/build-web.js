const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const webDir = path.join(__dirname, '..', '..', 'noter-app', 'apps', 'web');
const outDir = path.join(webDir, 'out');
const outIndexPath = path.join(outDir, 'index.html');
const rendererDir = path.join(__dirname, '..', 'renderer');

const run = (cmd, args) => {
  const result = spawnSync(cmd, args, { 
    cwd: webDir, 
    stdio: 'inherit', 
    shell: true,
    env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

run('npm', ['run', 'build']);
if (fs.existsSync(outDir) && fs.existsSync(outIndexPath)) {
  if (fs.existsSync(rendererDir)) {
    fs.rmSync(rendererDir, { recursive: true, force: true });
  }
  fs.mkdirSync(rendererDir, { recursive: true });
  fs.cpSync(outDir, rendererDir, { recursive: true });
} else {
  console.error('Renderer saknas eller är ofullständig eftersom web/out/index.html inte genererades');
  process.exit(1);
}
