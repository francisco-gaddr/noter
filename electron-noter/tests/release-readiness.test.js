const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8');
const buildWebJs = fs.readFileSync(path.join(rootDir, 'src', 'build-web.js'), 'utf8');

describe('electron release readiness', () => {
  it('gates build:ready behind readiness and tests', () => {
    expect(packageJson.scripts['build:ready']).toContain('npm run verify:build-ready');
    expect(packageJson.scripts['build:ready']).toContain('npm run test');
    expect(packageJson.scripts['build:ready']).toContain('npm run test:e2e');
    expect(packageJson.scripts['test:e2e']).toBe('node src/run-e2e.js');
  });

  it('keeps hardened BrowserWindow settings and strict renderer output checks', () => {
    expect(mainJs).toContain('contextIsolation: true');
    expect(mainJs).toContain('nodeIntegration: false');
    expect(mainJs).toContain('sandbox: true');
    expect(mainJs).toContain('setWindowOpenHandler');
    expect(buildWebJs).toContain("web/out/index.html");
    expect(buildWebJs).toContain('process.exit(1)');
  });
});
