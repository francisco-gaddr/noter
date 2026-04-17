const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const rendererStandaloneServer = path.join(rootDir, 'renderer-standalone', 'apps', 'web', 'server.js');
const rendererIndex = path.join(rootDir, 'renderer', 'index.html');
const legacyRendererIndex = path.join(rootDir, 'renderer', 'app', 'index.html');
const electronBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');

const runElectron = () => {
  spawn(electronBin, ['.'], { cwd: rootDir, stdio: 'inherit', shell: true });
};

if (fs.existsSync(rendererStandaloneServer) || fs.existsSync(rendererIndex) || fs.existsSync(legacyRendererIndex)) {
  runElectron();
} else {
  spawn('node', [path.join(__dirname, 'dev.js')], { cwd: __dirname, stdio: 'inherit', shell: true });
}
