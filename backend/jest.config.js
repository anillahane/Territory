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
      branches: 45,
      functions: 50,
      lines: 53,
      statements: 53,
    },
  },
  testMatch: ['**/tests/**/*.test.js'],
  setupFiles: ['<rootDir>/tests/setupEnv.js'],
  verbose: true,
};
