const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const mainJs = fs.readFileSync(path.join(rootDir, 'main.js'), 'utf8').replace(/\r\n/g, '\n');
const buildWebJs = fs.readFileSync(path.join(rootDir, 'src', 'build-web.js'), 'utf8').replace(/\r\n/g, '\n');
const startJs = fs.readFileSync(path.join(rootDir, 'src', 'start.js'), 'utf8').replace(/\r\n/g, '\n');

describe('electron release readiness', () => {
  it('gates build:ready behind readiness and tests', () => {
    expect(packageJson.scripts['build:ready']).toContain('npm run verify:build-ready');
    expect(packageJson.scripts['build:ready']).toContain('npm run test');
    expect(packageJson.scripts['build:ready']).toContain('npm run test:e2e');
    expect(packageJson.scripts['build:ready:mac']).toContain('npm run verify:build-ready');
    expect(packageJson.scripts['build:ready:mac']).toContain('npm run test');
    expect(packageJson.scripts['build:ready:mac']).toContain('npm run test:e2e');
    expect(packageJson.scripts['test:e2e']).toBe('node src/run-e2e.js');
  });

  it('declares mac arm64 build targets and notarization hook', () => {
    expect(packageJson.build.afterSign).toBe('src/notarize.js');
    expect(JSON.stringify(packageJson.build.asarUnpack)).toContain('renderer-standalone');
    expect(packageJson.build.mac.hardenedRuntime).toBe(true);
    expect(String(packageJson.build.mac.entitlements)).toContain('build/entitlements.mac.plist');
    expect(JSON.stringify(packageJson.build.mac.target)).toContain('arm64');
  });

  it('keeps hardened BrowserWindow settings and strict renderer output checks', () => {
    const writeSettingsStart = mainJs.indexOf('const writeSettings = (next) => {');
    const rewriteSettingsStart = mainJs.indexOf('const shouldRewriteSettingsOnStartup = () => {');
    const writeSettingsBlock = mainJs.slice(writeSettingsStart, rewriteSettingsStart);
    expect(mainJs).toContain('contextIsolation: true');
    expect(mainJs).toContain('nodeIntegration: false');
    expect(mainJs).toContain('sandbox: true');
    expect(mainJs).toContain('setWindowOpenHandler');
    expect(mainJs).toContain("const allowedExternalProtocols = new Set(['https:', 'http:'])");
    expect(mainJs).toContain('return allowedExternalProtocols.has(parsed.protocol);');
    expect(mainJs).toContain('const rendererRecoveryDelayMs = 2500;');
    expect(mainJs).toContain('scheduleRendererRecovery();');
    expect(mainJs).toContain("win.webContents.on('did-finish-load'");
    expect(mainJs).toContain('if (!safeStorage?.isEncryptionAvailable?.()) return {};');
    expect(mainJs).toContain('const writeSettings = (next) => {');
    expect(writeSettingsBlock).toContain("if (!safeStorage?.isEncryptionAvailable?.()) {\n    return true;\n  }");
    expect(mainJs).toContain("const filePath = path.join(app.getPath('userData'), settingsFileName);");
    expect(mainJs).toContain('const shouldRewriteSettingsOnStartup = () => {');
    expect(mainJs).toContain('if (!safeStorage?.isEncryptionAvailable?.()) {');
    expect(mainJs).toContain('return false;');
    expect(mainJs).toContain("if (shouldRewriteSettingsOnStartup()) {");
    expect(mainJs).toContain('__encrypted: true');
    expect(mainJs).toContain("payload: encrypted.toString('base64')");
    expect(mainJs).toContain("const getMlcModule = () => {");
    expect(mainJs).toContain("mlcModule = require('./src/mlc');");
    expect(mainJs).toContain("const startStandaloneRenderer = async () => {");
    expect(mainJs).toContain("renderer-standalone', 'apps', 'web', 'server.js'");
    expect(mainJs).toContain('show: isTest');
    expect(mainJs).toContain("if (!win.isVisible()) {");
    expect(buildWebJs).toContain("renderer-standalone");
    expect(buildWebJs).toContain("webDir, '.next', 'standalone'");
    expect(startJs).toContain("const rendererIndex = path.join(rootDir, 'renderer', 'index.html');");
    expect(startJs).toContain("const rendererStandaloneServer = path.join(rootDir, 'renderer-standalone', 'apps', 'web', 'server.js');");
    expect(startJs).toContain("if (fs.existsSync(rendererStandaloneServer) || fs.existsSync(rendererIndex) || fs.existsSync(legacyRendererIndex)) {");
    expect(buildWebJs).toContain('process.exit(1)');
  });
});
