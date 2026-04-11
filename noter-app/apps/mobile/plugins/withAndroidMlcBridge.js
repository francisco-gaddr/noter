const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const copyTemplate = (fromPath, toPath) => {
  ensureDir(path.dirname(toPath));
  fs.copyFileSync(fromPath, toPath);
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
    const mainJavaDir = path.join(androidRoot, 'main', 'java', 'com', 'noter', 'app');
    const androidTestDir = path.join(androidRoot, 'androidTest', 'java', 'com', 'noter', 'app');

    copyTemplate(path.join(templateDir, 'MLCModule.kt'), path.join(mainJavaDir, 'MLCModule.kt'));
    copyTemplate(path.join(templateDir, 'MLCPackage.kt'), path.join(mainJavaDir, 'MLCPackage.kt'));
    copyTemplate(path.join(templateDir, 'MLCConverterDeviceE2ETest.kt'), path.join(androidTestDir, 'MLCConverterDeviceE2ETest.kt'));
    ensureMainApplicationRegistration(path.join(mainJavaDir, 'MainApplication.kt'));

    return config;
  }]);
};
