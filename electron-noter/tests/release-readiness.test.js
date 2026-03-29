const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const buildWebJs = fs.readFileSync(path.join(rootDir, 'src', 'build-web.js'), 'utf8').replace(/\r\n/g, '\n');

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
    expect(mainJs).toContain("const allowedExternalProtocols = new Set(['https:', 'http:'])");
    expect(mainJs).toContain('return allowedExternalProtocols.has(parsed.protocol);');
    expect(mainJs).toContain("if (!safeStorage?.isEncryptionAvailable?.()) {\n    return false;\n  }");
    expect(mainJs).toContain('__encrypted: true');
    expect(mainJs).toContain("payload: encrypted.toString('base64')");
    expect(buildWebJs).toContain("web/out/index.html");
    expect(buildWebJs).toContain('process.exit(1)');
  });
});
