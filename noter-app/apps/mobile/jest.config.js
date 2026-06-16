module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|expo-modules-core)',
  ],
  setupFiles: ['./jest.setup.js'],
  moduleNameMapper: {
    // lib0 (yjs) pulls its RN webcrypto variant under jest-expo; redirect the
    // missing isomorphic-webcrypto onto our global.crypto-backed shim (see metro.config.js).
    '^isomorphic-webcrypto/src/react-native$': '<rootDir>/shims/lib0-webcrypto.js',
    '^isomorphic-webcrypto$': '<rootDir>/shims/lib0-webcrypto.js',
  },
};
