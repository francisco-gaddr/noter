const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: './',
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^react$': '<rootDir>/../../node_modules/react',
    '^react/jsx-runtime$': '<rootDir>/../../node_modules/react/jsx-runtime',
    '^react/jsx-dev-runtime$': '<rootDir>/../../node_modules/react/jsx-dev-runtime',
    '^react-dom$': '<rootDir>/../../node_modules/react-dom',
    '^react-dom/client$': '<rootDir>/../../node_modules/react-dom/client',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(react-dnd|dnd-core|@react-dnd|react-dnd-html5-backend)/)',
  ],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);
