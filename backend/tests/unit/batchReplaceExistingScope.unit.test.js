jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

jest.mock('../../src/config/queue', () => ({
  batchProcessQueue: {
    add: jest.fn(),
    client: {
      lpush: jest.fn(),
    },
    on: jest.fn(),
    process: jest.fn(),
  },
}));

jest.mock('../../src/services/MappingService', () => ({}));
jest.mock('../../src/services/BranchFinderService', () => ({}));

const batchRoutes = require('../../src/routes/batch');

const { resolveReplaceExistingScope } = batchRoutes.__testables;

describe('batch replaceExisting scope resolution', () => {
  test('returns none when replaceExisting is disabled', () => {
    expect(resolveReplaceExistingScope({
      replaceExisting: false,
      confirmWipeAll: false,
      mappings: [],
    })).toEqual({
      deleteMode: 'none',
      branchIds: [],
    });
  });

  test('returns global when confirmWipeAll is enabled', () => {
    expect(resolveReplaceExistingScope({
      replaceExisting: true,
      confirmWipeAll: true,
      mappings: [],
    })).toEqual({
      deleteMode: 'global',
      branchIds: [],
    });
  });

  test('returns scoped branch IDs when mapped branch codes are present', () => {
    expect(resolveReplaceExistingScope({
      replaceExisting: true,
      confirmWipeAll: false,
      mappings: [
        { existingBranchId: 'BR001' },
        { existingBranchId: 'BR002' },
        { existingBranchId: 'BR001' },
        { existingBranchId: null },
      ],
    })).toEqual({
      deleteMode: 'scoped',
      branchIds: ['BR001', 'BR002'],
    });
  });

  test('requires confirmWipeAll when no scoped branches are available', () => {
    expect(() => resolveReplaceExistingScope({
      replaceExisting: true,
      confirmWipeAll: false,
      mappings: [{ existingBranchId: null }],
    })).toThrow('confirmWipeAll=true');
  });
});
