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
const customEntryPluginPath = path.join(rootDir, 'plugins', 'withCustomEntryPoint.js');
const customBuildGradlePluginPath = path.join(rootDir, 'plugins', 'withCustomBuildGradle.js');
const androidMlcBridgePluginPath = path.join(rootDir, 'plugins', 'withAndroidMlcBridge.js');
const androidBridgePath = path.join(rootDir, 'services', 'ai', 'native', 'android', 'MLCModule.kt');
const androidPackagePath = path.join(rootDir, 'services', 'ai', 'native', 'android', 'MLCPackage.kt');
const androidDeviceE2EPath = path.join(rootDir, 'services', 'ai', 'native', 'android', 'MLCConverterDeviceE2ETest.kt');
const repoRoot = path.resolve(rootDir, '..', '..');
const easIgnorePath = path.join(repoRoot, '.easignore');
const workspaceParentEasIgnorePath = path.resolve(repoRoot, '..', '.easignore');
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
  warn(typeof extra?.eas?.projectId !== 'string' || extra.eas.projectId.trim().length === 0, 'expo.extra.eas.projectId är inte satt i repot. Kör eas init lokalt innan cloud-build.');

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
  ensure(typeof dependencies.i18next === 'string', 'dependency i18next saknas');
  ensure(typeof dependencies['react-i18next'] === 'string', 'dependency react-i18next saknas');
  ensure(typeof dependencies['react-native'] === 'string', 'dependency react-native saknas');
  ensure(typeof dependencies['react-native-fs'] === 'string', 'dependency react-native-fs saknas för lokal AI-modellhantering');
  ensure(typeof dependencies['react-native-zip-archive'] === 'string', 'dependency react-native-zip-archive saknas för modellpaket');

  const hasRouterPlugin = plugins.some((plugin) => plugin === 'expo-router');
  const hasBuildProperties = plugins.some((plugin) => plugin === 'expo-build-properties' || (Array.isArray(plugin) && plugin[0] === 'expo-build-properties'));
  const hasCustomEntryPlugin = plugins.some((plugin) => plugin === './plugins/withCustomEntryPoint');
  const hasCustomBuildGradlePlugin = plugins.some((plugin) => plugin === './plugins/withCustomBuildGradle');
  const hasAndroidMlcBridgePlugin = plugins.some((plugin) => plugin === './plugins/withAndroidMlcBridge');
  ensure(hasRouterPlugin, 'expo-router plugin saknas i app.json');
  ensure(hasBuildProperties, 'expo-build-properties plugin saknas i app.json');
  ensure(hasCustomEntryPlugin, 'withCustomEntryPoint-plugin saknas i app.json');
  ensure(hasCustomBuildGradlePlugin, 'withCustomBuildGradle-plugin saknas i app.json');
  ensure(hasAndroidMlcBridgePlugin, 'withAndroidMlcBridge-plugin saknas i app.json');
  ensure(fs.existsSync(customEntryPluginPath), 'plugins/withCustomEntryPoint.js saknas');
  ensure(fs.existsSync(customBuildGradlePluginPath), 'plugins/withCustomBuildGradle.js saknas');
  ensure(fs.existsSync(androidMlcBridgePluginPath), 'plugins/withAndroidMlcBridge.js saknas');
  ensure(fs.existsSync(androidBridgePath), 'android native MLCModule-template saknas');
  ensure(fs.existsSync(androidPackagePath), 'android native MLCPackage-template saknas');
  ensure(fs.existsSync(androidDeviceE2EPath), 'android native MLCConverterDeviceE2ETest-template saknas');

  const customBuildGradlePlugin = fs.readFileSync(customBuildGradlePluginPath, 'utf8');
  ensure(customBuildGradlePlugin.includes('mlc-llm.aar') || customBuildGradlePlugin.includes('MLC_ANDROID_AAR_PATH') || customBuildGradlePlugin.includes('MLC_ANDROID_DEPENDENCY'), 'withCustomBuildGradle måste kunna paketera MLC-runtime via AAR eller dependency');

  const easIgnore = fs.readFileSync(easIgnorePath, 'utf8');
  ensure(easIgnore.includes('apps/web/'), '.easignore bör exkludera apps/web/');
  ensure(easIgnore.includes('apps/backend/'), '.easignore bör exkludera apps/backend/');
  ensure(easIgnore.includes('apps/docs/'), '.easignore bör exkludera apps/docs/');
  if (fs.existsSync(workspaceParentEasIgnorePath)) {
    const workspaceParentEasIgnore = fs.readFileSync(workspaceParentEasIgnorePath, 'utf8');
    ensure(workspaceParentEasIgnore.includes('electron-noter/'), 'yttre .easignore bör exkludera electron-noter/');
    ensure(workspaceParentEasIgnore.includes('noter-app/apps/web/'), 'yttre .easignore bör exkludera noter-app/apps/web/');
  }

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
