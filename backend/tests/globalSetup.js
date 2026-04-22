const {
  setupTestDatabase,
  cleanupTestData,
  teardownTestDatabase,
} = require('./integration/setup');

module.exports = async () => {
  await setupTestDatabase();
  await cleanupTestData();
  await teardownTestDatabase();
};
