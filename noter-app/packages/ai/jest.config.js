module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only run source tests. Without this, jest also picks up the compiled copies
  // under dist/ (a duplicate suite + an empty .d.ts match), which fails the run.
  roots: ['<rootDir>/src'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
