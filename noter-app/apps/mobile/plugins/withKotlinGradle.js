const { withProjectBuildGradle, createRunOncePlugin } = require('@expo/config-plugins');

const withKotlinGradle = (config) => {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = setKotlinVersion(config.modResults.contents);
    }
    return config;
  });
};

function setKotlinVersion(buildGradle) {
  // Regex to match: kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.23'
  // Or just kotlinVersion = '1.9.23'
  // We want to force it to 2.1.20
  
  const kotlinVersionRegex = /kotlinVersion\s*=\s*.*$/m;
  const newKotlinVersion = `kotlinVersion = "1.9.24"`;

  if (kotlinVersionRegex.test(buildGradle)) {
    return buildGradle.replace(kotlinVersionRegex, newKotlinVersion);
  }

  // If not found, append it to buildscript ext if possible, or just top level (less safe)
  // But usually Expo templates have it.
  // Let's try to inject it at the start of buildscript { ext {
  
  if (buildGradle.includes('buildscript {')) {
      return buildGradle.replace('buildscript {', `buildscript {\n    ext {\n        kotlinVersion = "1.9.24"\n    }`);
  }
  
  return buildGradle;
}

module.exports = createRunOncePlugin(withKotlinGradle, 'withKotlinGradle', '1.0.0');
