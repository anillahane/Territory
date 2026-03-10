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
      branches: 18,
      functions: 24,
      lines: 33,
      statements: 33,
    },
  },
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  verbose: true,
};
