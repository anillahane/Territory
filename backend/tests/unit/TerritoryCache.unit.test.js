describe('TerritoryCache', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let createClientMock;
  let mockClient;

  const loadService = () => {
    jest.resetModules();
    jest.doMock('redis', () => ({
      createClient: jest.fn()
    }));
    ({ createClient: createClientMock } = require('redis'));
    createClientMock.mockReturnValue(mockClient);
    return require('../../src/services/TerritoryCache');
  };

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.DISABLE_REDIS_CACHE;

    mockClient = {
      on: jest.fn(),
      connect: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      sAdd: jest.fn().mockResolvedValue(1),
      sMembers: jest.fn().mockResolvedValue([]),
      del: jest.fn().mockResolvedValue(0)
    };
  });

  afterAll(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('buildVisualizationCacheKey is stable and sensitive to branch order and config version', () => {
    const TerritoryCache = loadService();

    const baseParams = {
      jobId: 'job-7',
      mode: 'nearest_pockets',
      branchIds: ['BR-01', 'BR-02'],
      customerView: 'selected_pockets',
      configVersion: 3
    };

    const firstKey = TerritoryCache.buildVisualizationCacheKey(baseParams);
    const repeatedKey = TerritoryCache.buildVisualizationCacheKey(baseParams);
    const reorderedKey = TerritoryCache.buildVisualizationCacheKey({
      ...baseParams,
      branchIds: ['BR-02', 'BR-01']
    });
    const newVersionKey = TerritoryCache.buildVisualizationCacheKey({
      ...baseParams,
      configVersion: 4
    });

    expect(firstKey).toBe(repeatedKey);
    expect(reorderedKey).not.toBe(firstKey);
    expect(newVersionKey).not.toBe(firstKey);
  });

  test('invalidateVisualizationCacheIfNeeded clears tracked entries when latest job changes', async () => {
    const TerritoryCache = loadService();

    mockClient.get
      .mockResolvedValueOnce('3')
      .mockResolvedValueOnce('job-1');
    mockClient.sMembers.mockResolvedValueOnce([
      'territory:visualization:v1:response:one',
      'territory:visualization:v1:response:two'
    ]);

    const invalidated = await TerritoryCache.invalidateVisualizationCacheIfNeeded({
      latestJobId: 'job-2',
      configVersion: 3
    });

    expect(invalidated).toBe(true);
    expect(mockClient.del).toHaveBeenCalledWith([
      'territory:visualization:v1:response:one',
      'territory:visualization:v1:response:two',
      'territory:visualization:v1:keys'
    ]);
    expect(mockClient.set).toHaveBeenCalledWith(
      'territory:visualization:v1:config-version',
      '3'
    );
    expect(mockClient.set).toHaveBeenCalledWith(
      'territory:visualization:v1:latest-job-id',
      'job-2'
    );
  });

  test('getCachedVisualization is a no-op when cache is disabled in test', async () => {
    process.env.NODE_ENV = 'test';
    const TerritoryCache = loadService();

    const cachedPayload = await TerritoryCache.getCachedVisualization('territory:test');

    expect(cachedPayload).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });
});
