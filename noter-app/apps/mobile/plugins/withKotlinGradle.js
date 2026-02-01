const { withProjectBuildGradle, createRunOncePlugin } = require('@expo/config-plugins');

const withKotlinGradle = (config) => {
  return withProjectBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      config.modResults.contents = setKotlinVersion(config.modResults.contents);
      config.modResults.contents = addResolutionStrategy(config.modResults.contents);
    }
    return config;
  });
};

function setKotlinVersion(buildGradle) {
  // Regex to match: kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.23'
  // Or just kotlinVersion = '1.9.23'
  // We want to force it to 1.9.24
  
  const kotlinVersionRegex = /kotlinVersion\s*=\s*.*$/m;
  const newKotlinVersion = `kotlinVersion = "1.9.24"`;

  if (kotlinVersionRegex.test(buildGradle)) {
    return buildGradle.replace(kotlinVersionRegex, newKotlinVersion);
  }

  // If not found, append it to buildscript ext if possible
  if (buildGradle.includes('buildscript {')) {
      return buildGradle.replace('buildscript {', `buildscript {\n    ext {\n        kotlinVersion = "1.9.24"\n    }`);
  }
  
  return buildGradle;
}

function addResolutionStrategy(buildGradle) {
    // Check if we already added it to avoid duplicates
    if (buildGradle.includes('force "org.jetbrains.kotlin:kotlin-stdlib:$kotlinVersion"')) {
        return buildGradle;
    }

    const strategy = `
    configurations.all {
        resolutionStrategy {
            force "org.jetbrains.kotlin:kotlin-stdlib:$kotlinVersion"
            force "org.jetbrains.kotlin:kotlin-reflect:$kotlinVersion"
            force "org.jetbrains.kotlin:kotlin-stdlib-jdk7:$kotlinVersion"
            force "org.jetbrains.kotlin:kotlin-stdlib-jdk8:$kotlinVersion"
            force "org.jetbrains.kotlin:kotlin-stdlib-common:$kotlinVersion"
        }
    }
`;

    // Inject into allprojects block
    if (buildGradle.includes('allprojects {')) {
        return buildGradle.replace('allprojects {', `allprojects {${strategy}`);
    }
    
    // Fallback: append at the end
    return buildGradle + `\nallprojects {${strategy}}\n`;
}

module.exports = createRunOncePlugin(withKotlinGradle, 'withKotlinGradle', '1.0.0');
