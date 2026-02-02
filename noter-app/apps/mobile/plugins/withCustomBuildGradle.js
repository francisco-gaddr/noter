const { withAppBuildGradle } = require('@expo/config-plugins');

const withCustomBuildGradle = (config) => {
  return withAppBuildGradle(config, (config) => {
    if (config.modResults.language === 'groovy') {
      const buildGradle = config.modResults.contents;
      
      // Improved regex to capture the entire entryFile assignment line(s)
      // Matches: entryFile = file(["node", ... ].execute(..., ...).text.trim())
      // We use [\s\S]*? to match across lines if necessary, but anchor to the specific structure
      // We explicitly look for the .text.trim()) ending to ensure we consume the whole statement
      const pattern = /entryFile\s*=\s*file\(\s*\[\s*"node"[\s\S]*?\.execute\([\s\S]*?\)\.text\.trim\(\)\)/;
      
      if (pattern.test(buildGradle)) {
        console.log('[withCustomBuildGradle] Found resolveAppEntry pattern, replacing with explicit index.js...');
        config.modResults.contents = buildGradle.replace(
          pattern,
          'entryFile = file("${projectRoot}/index.js")'
        );
      } else {
        console.warn('[withCustomBuildGradle] Could not find specific resolveAppEntry pattern. Checking for simpler pattern...');
        
        // Fallback: try to match just the assignment if the complex regex fails
        // This is riskier but might catch variations. We assume it ends with a closing parenthesis for file(...)
        const fallbackPattern = /entryFile\s*=\s*file\(\s*\["node"[\s\S]*?\)\s*$/m;
        
        if (fallbackPattern.test(buildGradle)) {
             console.log('[withCustomBuildGradle] Found fallback pattern, patching...');
             config.modResults.contents = buildGradle.replace(
                fallbackPattern,
                'entryFile = file("${projectRoot}/index.js")'
             );
        } else {
             console.warn('[withCustomBuildGradle] No entryFile configuration found to patch.');
        }
      }
    }
    return config;
  });
};

module.exports = withCustomBuildGradle;
