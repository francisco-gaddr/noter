const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const normalizePackagePath = (packageName) => packageName.split('.').join(path.sep);

const copyTemplate = (fromPath, toPath, packageName) => {
  ensureDir(path.dirname(toPath));
  let content = fs.readFileSync(fromPath, 'utf8');
  if (packageName) {
    content = content.replace(/^package\s+.+$/m, `package ${packageName}`);
  }
  fs.writeFileSync(toPath, content);
};

const ensureMainApplicationRegistration = (mainApplicationPath) => {
  if (!fs.existsSync(mainApplicationPath)) {
    return;
  }
  const current = fs.readFileSync(mainApplicationPath, 'utf8');
  if (current.includes('add(MLCPackage())')) {
    return;
  }
  const next = current.replace(
    /PackageList\(this\)\.packages\.apply\s*\{\s*/,
    (match) => `${match}              add(MLCPackage())\n`
  );
  fs.writeFileSync(mainApplicationPath, next);
};

module.exports = function withAndroidMlcBridge(config) {
  return withDangerousMod(config, ['android', async (config) => {
    const projectRoot = config.modRequest.projectRoot;
    const templateDir = path.join(projectRoot, 'services', 'ai', 'native', 'android');
    const androidRoot = path.join(projectRoot, 'android', 'app', 'src');
    const packageName = config.android?.package || 'com.noter.app';
    const packagePath = normalizePackagePath(packageName);
    const mainJavaDir = path.join(androidRoot, 'main', 'java', packagePath);
    const androidTestDir = path.join(androidRoot, 'androidTest', 'java', packagePath);

    copyTemplate(path.join(templateDir, 'MLCModule.kt'), path.join(mainJavaDir, 'MLCModule.kt'), packageName);
    copyTemplate(path.join(templateDir, 'MLCPackage.kt'), path.join(mainJavaDir, 'MLCPackage.kt'), packageName);
    copyTemplate(path.join(templateDir, 'MLCConverterDeviceE2ETest.kt'), path.join(androidTestDir, 'MLCConverterDeviceE2ETest.kt'), packageName);
    ensureMainApplicationRegistration(path.join(mainJavaDir, 'MainApplication.kt'));

    return config;
  }]);
};
