const { withMainApplication } = require('@expo/config-plugins');

const withCustomEntryPoint = (config) => {
  return withMainApplication(config, (config) => {
    // Replace the default getJSMainModuleName implementation
    if (config.modResults.language === 'kt') {
        const contents = config.modResults.contents;
        if (contents.includes('getJSMainModuleName')) {
            console.log('[withCustomEntryPoint] Patching Kotlin getJSMainModuleName...');
            config.modResults.contents = contents.replace(
                /override fun getJSMainModuleName\(\): String = .*/,
                'override fun getJSMainModuleName(): String = "index"'
            );
        }
    } else {
        // Fallback for Java (just in case)
        if (config.modResults.contents.includes('getJSMainModuleName')) {
            console.log('[withCustomEntryPoint] Patching Java getJSMainModuleName...');
            config.modResults.contents = config.modResults.contents.replace(
                /protected String getJSMainModuleName\(\) \{\n\s+return .*/,
                'protected String getJSMainModuleName() {\n        return "index";'
            );
        }
    }
    return config;
  });
};

module.exports = withCustomEntryPoint;
