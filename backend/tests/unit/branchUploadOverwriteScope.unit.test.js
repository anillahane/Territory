jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
  transaction: jest.fn(),
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../src/config/queue', () => ({
  branchUploadQueue: {
    process: jest.fn(),
  },
}));

const { resolveBranchOverwriteScope } = require('../../src/workers/branchUploadWorker');

describe('branch overwrite scope resolution', () => {
  test('returns none when uploadMode is add', () => {
    expect(resolveBranchOverwriteScope('add', false, [{ id: 'BR001' }])).toEqual({
      deleteMode: 'none',
      branchIds: [],
    });
  });

  test('returns global when confirmWipeAll is enabled', () => {
    expect(resolveBranchOverwriteScope('overwrite', true, [{ id: 'BR001' }])).toEqual({
      deleteMode: 'global',
      branchIds: [],
    });
  });

  test('returns scoped branch IDs for overwrite uploads by default', () => {
    expect(resolveBranchOverwriteScope('overwrite', false, [
      { id: 'BR001' },
      { id: 'BR002' },
      { id: 'BR001' },
    ])).toEqual({
      deleteMode: 'scoped',
      branchIds: ['BR001', 'BR002'],
    });
  });

  test('requires confirmWipeAll when overwrite uploads have no branch IDs', () => {
    expect(() => resolveBranchOverwriteScope('overwrite', false, [{ id: '' }]))
      .toThrow('confirmWipeAll=true');
  });
});
