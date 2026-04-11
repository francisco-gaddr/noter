const { withAppBuildGradle } = require('@expo/config-plugins');

const ensureMlcConfig = (buildGradle) => {
  let next = buildGradle;

  if (!next.includes('def bundledMlcAar = file("$projectDir/libs/mlc-llm.aar")')) {
    next = next.replace(
      /def enableMinifyInReleaseBuilds = .*?\n/,
      (match) => `${match}def bundledMlcAar = file("$projectDir/libs/mlc-llm.aar")\ndef configuredMlcAarPath = (findProperty('noter.mlcAndroidAarPath') ?: System.getenv('MLC_ANDROID_AAR_PATH') ?: '').toString().trim()\ndef configuredMlcDependency = (findProperty('noter.mlcAndroidDependency') ?: System.getenv('MLC_ANDROID_DEPENDENCY') ?: '').toString().trim()\n`
    );
  }

  if (!next.includes('if (bundledMlcAar.exists()) {')) {
    next = next.replace(
      /\n}\s*$/,
      `\n\n    if (bundledMlcAar.exists()) {\n        implementation files(bundledMlcAar)\n    } else if (configuredMlcAarPath) {\n        implementation files(configuredMlcAarPath)\n    } else if (configuredMlcDependency) {\n        implementation(configuredMlcDependency)\n    }\n}\n`
    );
  }

  return next;
};

const withCustomBuildGradle = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      let buildGradle = config.modResults.contents;
      
      const pattern = /entryFile\s*=\s*file\(\s*\[\s*"node"[\s\S]*?\.execute\([\s\S]*?\)\.text\.trim\(\)\)/;
      
      if (pattern.test(buildGradle)) {
        console.log('[withCustomBuildGradle] Found resolveAppEntry pattern, replacing with explicit index.js...');
        buildGradle = buildGradle.replace(
          pattern,
          'entryFile = file("${projectRoot}/index.js")'
        );
      } else {
        console.warn('[withCustomBuildGradle] Could not find specific resolveAppEntry pattern. Checking for simpler pattern...');
        
        const fallbackPattern = /entryFile\s*=\s*file\(\s*\["node"[\s\S]*?\)\s*$/m;
        
        if (fallbackPattern.test(buildGradle)) {
             console.log('[withCustomBuildGradle] Found fallback pattern, patching...');
             buildGradle = buildGradle.replace(
                fallbackPattern,
                'entryFile = file("${projectRoot}/index.js")'
             );
        } else {
             console.warn('[withCustomBuildGradle] No entryFile configuration found to patch.');
        }
      }
      config.modResults.contents = ensureMlcConfig(buildGradle);
    }
    return config;
  });
};

module.exports = withCustomBuildGradle;
