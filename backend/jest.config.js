module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/app.js',
    '!src/migrations/**',
  ],
  coverageThreshold: {
    global: {
      branches: 33,
      functions: 27,
      lines: 39,
      statements: 39,
    },
  },
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  verbose: true,
};
