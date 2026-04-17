const fs = require('fs');
const path = require('path');

const errors = [];

const ensure = (condition, message) => {
  if (!condition) errors.push(message);
};

const parseMajor = (value) => {
  const raw = String(value || '').split('.')[0];
  const major = Number(raw);
  return Number.isFinite(major) ? major : 0;
};

const rootDir = path.join(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const mainPath = path.join(rootDir, 'main.js');
const preloadPath = path.join(rootDir, 'preload.js');
const startScriptPath = path.join(rootDir, 'src', 'start.js');
const buildWebPath = path.join(rootDir, 'src', 'build-web.js');
const buildMacPath = path.join(rootDir, 'src', 'build-mac.js');
const notarizePath = path.join(rootDir, 'src', 'notarize.js');
const macEntitlementsPath = path.join(rootDir, 'build', 'entitlements.mac.plist');
const webPackagePath = path.join(rootDir, '..', 'noter-app', 'apps', 'web', 'package.json');
const webNextConfigPath = path.join(rootDir, '..', 'noter-app', 'apps', 'web', 'next.config.js');

ensure(fs.existsSync(packageJsonPath), 'electron-noter/package.json saknas');
ensure(fs.existsSync(mainPath), 'electron-noter/main.js saknas');
ensure(fs.existsSync(preloadPath), 'electron-noter/preload.js saknas');
ensure(fs.existsSync(startScriptPath), 'electron-noter/src/start.js saknas');
ensure(fs.existsSync(buildWebPath), 'electron-noter/src/build-web.js saknas');
ensure(fs.existsSync(buildMacPath), 'electron-noter/src/build-mac.js saknas');
ensure(fs.existsSync(notarizePath), 'electron-noter/src/notarize.js saknas');
ensure(fs.existsSync(macEntitlementsPath), 'electron-noter/build/entitlements.mac.plist saknas');
ensure(fs.existsSync(webPackagePath), 'noter-app/apps/web/package.json saknas för Electron-rendering');
ensure(fs.existsSync(webNextConfigPath), 'noter-app/apps/web/next.config.js saknas för Electron-export');

const nodeMajor = parseMajor(process.versions.node);
ensure(nodeMajor >= 18, `Node-version ${process.versions.node} är för låg. Kräver >=18`);

if (errors.length === 0) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const webPackageJson = JSON.parse(fs.readFileSync(webPackagePath, 'utf8'));
  const mainJs = fs.readFileSync(mainPath, 'utf8');

  ensure(typeof packageJson.scripts?.build === 'string', 'script build saknas i electron-noter');
  ensure(typeof packageJson.scripts?.['build:web'] === 'string', 'script build:web saknas i electron-noter');
  ensure(typeof packageJson.scripts?.['build:ready'] === 'string', 'script build:ready saknas i electron-noter');
  ensure(typeof packageJson.scripts?.['build:ready:mac'] === 'string', 'script build:ready:mac saknas i electron-noter');
  ensure(typeof packageJson.scripts?.['build:mac:arm64'] === 'string', 'script build:mac:arm64 saknas i electron-noter');
  ensure(typeof packageJson.scripts?.['verify:build-ready'] === 'string', 'script verify:build-ready saknas i electron-noter');
  ensure(typeof packageJson.scripts?.['test:e2e'] === 'string', 'script test:e2e saknas i electron-noter');
  ensure(typeof packageJson.scripts?.['test:e2e:ui'] === 'string', 'script test:e2e:ui saknas i electron-noter');
  ensure(typeof packageJson.build?.appId === 'string' && packageJson.build.appId.trim().length > 0, 'electron build.appId saknas');
  ensure(typeof packageJson.build?.productName === 'string' && packageJson.build.productName.trim().length > 0, 'electron build.productName saknas');
  ensure(Array.isArray(packageJson.build?.asarUnpack), 'electron build.asarUnpack saknas');
  ensure(JSON.stringify(packageJson.build?.asarUnpack || []).includes('renderer-standalone'), 'electron build.asarUnpack måste inkludera renderer-standalone');
  ensure(typeof packageJson.build?.afterSign === 'string', 'electron build.afterSign saknas (notarization hook)');
  ensure(packageJson.build?.mac?.hardenedRuntime === true, 'electron build.mac.hardenedRuntime måste vara true');
  ensure(typeof packageJson.build?.mac?.entitlements === 'string', 'electron build.mac.entitlements saknas');
  ensure(Array.isArray(packageJson.build?.mac?.target), 'electron build.mac.target saknas');
  ensure(
    JSON.stringify(packageJson.build?.mac?.target || '').includes('arm64'),
    'electron build.mac.target måste inkludera arm64',
  );
  ensure(typeof webPackageJson.scripts?.build === 'string', 'web script build saknas');
  ensure(String(packageJson.scripts?.['build:ready']).includes('npm run verify:build-ready'), 'build:ready måste köra verify:build-ready');
  ensure(String(packageJson.scripts?.['build:ready']).includes('npm run test'), 'build:ready måste köra tester');
  ensure(String(packageJson.scripts?.['build:ready']).includes('npm run test:e2e'), 'build:ready måste köra Electron E2E');
  ensure(String(packageJson.scripts?.['build:ready:mac']).includes('npm run test:e2e:ui'), 'build:ready:mac måste köra Electron UI E2E');
  ensure(fs.readFileSync(buildWebPath, 'utf8').includes("renderer-standalone"), 'build-web måste bygga renderer-standalone');
  ensure(mainJs.includes('contextIsolation: true'), 'main.js måste ha contextIsolation: true');
  ensure(mainJs.includes('nodeIntegration: false'), 'main.js måste ha nodeIntegration: false');
  ensure(mainJs.includes('sandbox: true'), 'main.js måste ha sandbox: true');
  ensure(mainJs.includes('setWindowOpenHandler'), 'main.js bör blockera externa popupfönster via setWindowOpenHandler');
}

if (errors.length > 0) {
  console.error('Build readiness misslyckades för electron-noter:');
  for (const item of errors) console.error(`- ${item}`);
  process.exit(1);
}

console.log('Electron build readiness OK');
