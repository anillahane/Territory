const xlsx = require('xlsx');
const { validateUploadedExcelFile } = require('../../src/utils/fileValidation');

describe('file validation', () => {
  test('rejects a renamed executable masquerading as xlsx', async () => {
    await expect(validateUploadedExcelFile({
      originalname: 'payload.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: 128,
      buffer: Buffer.from('MZP\x00\x02\x00', 'binary')
    })).rejects.toMatchObject({
      code: 'INVALID_FILE_SIGNATURE'
    });
  });

  test('accepts a valid workbook under the row cap', async () => {
    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet([
      { Latitude: 22.7, Longitude: 75.9, 'Branch Code': '105' }
    ]);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const result = await validateUploadedExcelFile({
      originalname: 'branches.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: buffer.length,
      buffer
    });

    expect(result.sanitizedFileName).toBe('branches.xlsx');
    expect(result.rowCount).toBe(1);
  });
});
