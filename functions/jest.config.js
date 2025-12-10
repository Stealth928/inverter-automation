module.exports = {
  testEnvironment: 'node',
  coveragePathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'index.js',
    '!**/node_modules/**'
  ],
  verbose: true,
  testTimeout: 10000
};
