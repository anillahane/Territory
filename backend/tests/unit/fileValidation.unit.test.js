const xlsx = require('xlsx');
const {
  MAX_ROW_COUNT,
  sanitizeFilename,
  validateUploadedWorkbook,
} = require('../../src/utils/fileValidation');

const buildWorkbookBuffer = (rows = [['Customer ID'], ['cust-1']]) => {
  const worksheet = xlsx.utils.aoa_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

describe('fileValidation utility', () => {
  const originalFetch = global.fetch;
  const originalScanHookUrl = process.env.SCAN_HOOK_URL;

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalScanHookUrl === undefined) {
      delete process.env.SCAN_HOOK_URL;
    } else {
      process.env.SCAN_HOOK_URL = originalScanHookUrl;
    }
  });

  test('sanitizeFilename strips path separators and caps length at 200 characters', () => {
    const sanitized = sanitizeFilename('..\\nested/path/' + 'a'.repeat(250) + '.xlsx');

    expect(sanitized).not.toContain('/');
    expect(sanitized).not.toContain('\\');
    expect(sanitized.length).toBeLessThanOrEqual(200);
    expect(sanitized.endsWith('.xlsx')).toBe(true);
  });

  test('validateUploadedWorkbook accepts a valid xlsx workbook and counts rows', async () => {
    const file = {
      originalname: 'branches.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buildWorkbookBuffer([['Branch ID'], ['B-1'], ['B-2']]),
    };

    const result = await validateUploadedWorkbook(file);

    expect(result).toEqual({
      sanitizedFileName: 'branches.xlsx',
      rowCount: 2,
    });
  });

  test('validateUploadedWorkbook normalizes the saved extension to the detected workbook type', async () => {
    const file = {
      originalname: '..\\nested/path/payload.exe',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buildWorkbookBuffer([['Branch ID'], ['B-1']]),
    };

    const result = await validateUploadedWorkbook(file);

    expect(result.sanitizedFileName).toBe('payload.xlsx');
  });

  test('validateUploadedWorkbook rejects a renamed executable buffer', async () => {
    const disguisedExe = {
      originalname: 'payload.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('4d5a90000300000004000000ffff0000', 'hex'),
    };

    await expect(validateUploadedWorkbook(disguisedExe)).rejects.toMatchObject({
      statusCode: 415,
      code: 'INVALID_FILE_SIGNATURE',
    });
  });

  test('validateUploadedWorkbook rejects generic zip payloads that are not readable workbooks', async () => {
    const disguisedZip = {
      originalname: 'payload.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('504b0304140000000000000000000000000000000000000000000000', 'hex'),
    };

    await expect(validateUploadedWorkbook(disguisedZip)).rejects.toMatchObject({
      statusCode: 415,
      code: 'INVALID_WORKBOOK',
    });
  });

  test('validateUploadedWorkbook rejects workbooks above the row cap', async () => {
    const file = {
      originalname: 'oversized.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buildWorkbookBuffer([['Customer ID'], ['cust-1']]),
    };

    jest.spyOn(xlsx.utils, 'sheet_to_json').mockReturnValue(new Array(MAX_ROW_COUNT + 2).fill(['row']));

    await expect(validateUploadedWorkbook(file)).rejects.toMatchObject({
      statusCode: 422,
      code: 'ROW_LIMIT_EXCEEDED',
    });
  });

  test('validateUploadedWorkbook rejects files when the scan hook returns non-200', async () => {
    process.env.SCAN_HOOK_URL = 'https://scanner.example.test/scan';
    global.fetch = jest.fn().mockResolvedValue({ status: 503 });

    const file = {
      originalname: 'scan-me.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: buildWorkbookBuffer([['Branch ID'], ['B-1']]),
    };

    await expect(validateUploadedWorkbook(file)).rejects.toMatchObject({
      statusCode: 422,
      code: 'SCAN_REJECTED',
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
