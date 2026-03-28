const fs = require('fs');
const path = require('path');

const errors = [];
const warnings = [];

const ensure = (condition, message) => {
  if (!condition) errors.push(message);
};
const warn = (condition, message) => {
  if (!condition) warnings.push(message);
};

const readJson = (filePath) => {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
};

const rootDir = path.resolve(__dirname, '..');
const appJsonPath = path.join(rootDir, 'app.json');
const easJsonPath = path.join(rootDir, 'eas.json');
const packageJsonPath = path.join(rootDir, 'package.json');
const repoRoot = path.resolve(rootDir, '..', '..');
const easIgnorePath = path.join(repoRoot, '.easignore');
const workspaceEasPath = path.join(repoRoot, 'eas.json');
const rootEasPath = path.resolve(repoRoot, '..', 'eas.json');

ensure(fs.existsSync(appJsonPath), 'apps/mobile/app.json saknas');
ensure(fs.existsSync(easJsonPath), 'apps/mobile/eas.json saknas');
ensure(fs.existsSync(packageJsonPath), 'apps/mobile/package.json saknas');
ensure(fs.existsSync(easIgnorePath), 'noter-app/.easignore saknas');

if (errors.length === 0) {
  const appJson = readJson(appJsonPath);
  const easJson = readJson(easJsonPath);
  const packageJson = readJson(packageJsonPath);
  const expo = appJson.expo || {};
  const android = expo.android || {};
  const ios = expo.ios || {};
  const extra = expo.extra || {};
  const build = easJson.build || {};
  const plugins = Array.isArray(expo.plugins) ? expo.plugins : [];
  const dependencies = packageJson.dependencies || {};
  const scripts = packageJson.scripts || {};
  const androidPackagePattern = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;

  ensure(typeof expo.name === 'string' && expo.name.trim().length > 0, 'expo.name måste vara satt');
  ensure(typeof expo.slug === 'string' && expo.slug.trim().length > 0, 'expo.slug måste vara satt');
  ensure(typeof expo.version === 'string' && expo.version.trim().length > 0, 'expo.version måste vara satt');
  ensure(typeof android.package === 'string' && android.package.trim().length > 0, 'expo.android.package måste vara satt');
  ensure(androidPackagePattern.test(android.package || ''), 'expo.android.package måste vara ett giltigt Android package-namn');
  ensure(typeof ios.bundleIdentifier === 'string' && ios.bundleIdentifier.trim().length > 0, 'expo.ios.bundleIdentifier måste vara satt');
  ensure(typeof extra?.eas?.projectId === 'string' && extra.eas.projectId.trim().length > 0, 'expo.extra.eas.projectId måste vara satt');

  ensure(typeof build?.apk?.android?.buildType === 'string' && build.apk.android.buildType === 'apk', 'eas build.apk.android.buildType måste vara apk');
  ensure(typeof build?.preview?.android?.buildType === 'string' && build.preview.android.buildType === 'apk', 'eas build.preview.android.buildType måste vara apk');
  ensure(typeof build?.production === 'object', 'eas build.production måste vara definierad');

  ensure(typeof scripts['build:apk'] === 'string', 'script build:apk saknas');
  ensure(typeof scripts['build:apk:ready'] === 'string', 'script build:apk:ready saknas');
  ensure(typeof scripts['build:apk:preflight'] === 'string', 'script build:apk:preflight saknas');
  ensure(typeof scripts['verify:build-ready'] === 'string', 'script verify:build-ready saknas');
  ensure(String(scripts['build:apk:preflight']).includes('check-types'), 'build:apk:preflight måste köra check-types');
  ensure(String(scripts['build:apk:preflight']).includes('test'), 'build:apk:preflight måste köra tester');
  ensure(String(scripts['build:apk:preflight']).includes('expo config --type introspect'), 'build:apk:preflight måste köra expo config --type introspect');
  ensure(String(scripts['build:apk']).includes('npx') && String(scripts['build:apk']).includes('eas-cli'), 'build:apk måste använda npx eas-cli');
  ensure(String(scripts['build:android']).includes('npx') && String(scripts['build:android']).includes('eas-cli'), 'build:android måste använda npx eas-cli');

  ensure(typeof dependencies.expo === 'string', 'dependency expo saknas');
  ensure(typeof dependencies['expo-router'] === 'string', 'dependency expo-router saknas');
  ensure(typeof dependencies['expo-secure-store'] === 'string', 'dependency expo-secure-store saknas');
  ensure(typeof dependencies['expo-sqlite'] === 'string', 'dependency expo-sqlite saknas');
  ensure(typeof dependencies['react-native'] === 'string', 'dependency react-native saknas');

  const hasRouterPlugin = plugins.some((plugin) => plugin === 'expo-router');
  const hasBuildProperties = plugins.some((plugin) => plugin === 'expo-build-properties' || (Array.isArray(plugin) && plugin[0] === 'expo-build-properties'));
  ensure(hasRouterPlugin, 'expo-router plugin saknas i app.json');
  ensure(hasBuildProperties, 'expo-build-properties plugin saknas i app.json');

  const easIgnore = fs.readFileSync(easIgnorePath, 'utf8');
  ensure(easIgnore.includes('apps/web/'), '.easignore bör exkludera apps/web/');
  ensure(easIgnore.includes('apps/backend/'), '.easignore bör exkludera apps/backend/');
  ensure(easIgnore.includes('apps/docs/'), '.easignore bör exkludera apps/docs/');

  const hasWorkspaceEas = fs.existsSync(workspaceEasPath);
  const hasRootEas = fs.existsSync(rootEasPath);
  warn(!(hasWorkspaceEas && hasRootEas), 'Flera eas.json upptäckta på workspace/root-nivå. Säkerställ att build körs i noter-app/apps/mobile.');
}

if (errors.length > 0) {
  console.error('Build readiness misslyckades för mobile:');
  for (const item of errors) console.error(`- ${item}`);
  process.exit(1);
}

if (warnings.length > 0) {
  for (const item of warnings) console.warn(`Varning: ${item}`);
}

console.log('Mobile build readiness OK');
