module.exports = {
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'index.js',
    '!**/node_modules/**'
  ],
  coverageThreshold: {
    global: {
      statements: 3, // Start low, increase incrementally
      branches: 1,
      functions: 0.5,
      lines: 3
    }
  },
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
  testTimeout: 10000
};
