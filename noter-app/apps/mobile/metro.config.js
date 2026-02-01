const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch all files within the monorepo
config.watchFolders = [workspaceRoot];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Force Metro to resolve (sub)dependencies from the `node_modules`
config.resolver.disableHierarchicalLookup = true;

// 4. WASM Support for expo-sqlite
// We treat wasm as an asset so it returns a URI, which is what the web worker typically expects
config.resolver.assetExts.push('wasm');
config.resolver.sourceExts = config.resolver.sourceExts.filter(ext => ext !== 'wasm');

// Workaround for expo-sqlite/wa-sqlite resolution in monorepo/metro
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith('wa-sqlite.wasm')) {
    const fs = require('fs');
    const path = require('path');
    // Try to find the file in the expected location relative to the module requesting it
    // or fallback to searching in node_modules
    
    // Direct path check in project node_modules
    const explicitPath = path.resolve(projectRoot, 'node_modules/expo-sqlite/web/wa-sqlite/wa-sqlite.wasm');
    if (fs.existsSync(explicitPath)) {
      return {
        filePath: explicitPath,
        type: 'asset',
      };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
