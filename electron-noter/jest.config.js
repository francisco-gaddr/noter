module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  modulePathIgnorePatterns: [
    '<rootDir>/dist-.*',
    '<rootDir>/dist-electron-.*',
  ],
  watchPathIgnorePatterns: [
    '<rootDir>/dist-.*',
    '<rootDir>/dist-electron-.*',
  ],
};
