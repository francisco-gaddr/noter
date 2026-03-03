const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const rendererIndex = path.join(rootDir, 'renderer', 'app', 'index.html');
const electronBin = path.join(rootDir, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');

const runElectron = () => {
  spawn(electronBin, ['.'], { cwd: rootDir, stdio: 'inherit', shell: true });
};

if (fs.existsSync(rendererIndex)) {
  runElectron();
} else {
  spawn('node', [path.join(__dirname, 'dev.js')], { cwd: __dirname, stdio: 'inherit', shell: true });
}
