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
  const newKotlinVersion = `kotlinVersion = "2.1.0"`;

  if (kotlinVersionRegex.test(buildGradle)) {
    return buildGradle.replace(kotlinVersionRegex, newKotlinVersion);
  }

  // If not found, append it to buildscript ext if possible
  if (buildGradle.includes('buildscript {')) {
      return buildGradle.replace('buildscript {', `buildscript {\n    ext {\n        kotlinVersion = "2.1.0"\n    }`);
  }
  
  return buildGradle;
}

function addResolutionStrategy(buildGradle) {
    if (buildGradle.includes('buildscript {')) {
        // Add resolution strategy to buildscript dependencies if needed, or simply ensure we force kotlin version in main project
        // Note: buildscript block usually doesn't support resolutionStrategy in the same way, but we can try to force it via configurations
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

    // Apply to allprojects
    if (buildGradle.includes('allprojects {')) {
        buildGradle = buildGradle.replace('allprojects {', `allprojects {${strategy}`);
    } else {
        buildGradle = buildGradle + `\nallprojects {${strategy}}\n`;
    }

    // Also apply to root project configurations directly to catch plugins applied to root
    if (!buildGradle.includes('resolutionStrategy {') || !buildGradle.includes(`force "org.jetbrains.kotlin:kotlin-stdlib:$kotlinVersion"`)) {
         // This might be redundant if allprojects covers it, but good for safety
    }

    return buildGradle;
}

module.exports = createRunOncePlugin(withKotlinGradle, 'withKotlinGradle', '1.0.0');
