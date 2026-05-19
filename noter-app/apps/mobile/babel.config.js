const path = require('path');

// EAS workers run `expo export:embed` from the monorepo root (noter-app/),
// not from apps/mobile/. babel-preset-expo's auto-detection of the
// expo-router app dir then picks the wrong location and bakes the
// literal `process.env.EXPO_ROUTER_APP_ROOT` into _ctx.android.js —
// require.context() rejects that with "First argument should be a
// string". Anchoring the env var to __dirname/app makes the inlined
// value an absolute path before metro-transform-worker runs.
if (!process.env.EXPO_ROUTER_APP_ROOT) {
  process.env.EXPO_ROUTER_APP_ROOT = path.resolve(__dirname, 'app');
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
