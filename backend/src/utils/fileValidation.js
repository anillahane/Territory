const multer = require('multer');
const path = require('path');
const xlsx = require('xlsx');
const FileType = require('file-type');
const { AppError } = require('../middleware/errorHandler');

const MAX_UPLOAD_SIZE_MB = 10;
const MAX_ROW_COUNT = 100000;
const MAGIC_BYTE_SAMPLE_SIZE = 4096;
const EXCEL_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

const XLS_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]);
const ZIP_SIGNATURES = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];

const startsWithSignature = (buffer, signature) =>
  Buffer.isBuffer(buffer)
  && buffer.length >= signature.length
  && buffer.subarray(0, signature.length).equals(signature);

const isZipSignature = (buffer) => ZIP_SIGNATURES.some((signature) => startsWithSignature(buffer, signature));

const normalizeWorkbookExtension = (extension) => {
  const normalized = String(extension || '').replace(/^\./, '').toLowerCase();
  return normalized === 'xls' ? '.xls' : '.xlsx';
};

const sanitizeFilename = (originalName, extensionOverride) => {
  const rawName = String(originalName || 'upload.xlsx')
    .split(/[\\/]+/)
    .pop()
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const fallbackName = rawName || 'upload.xlsx';
  const originalExtension = path.extname(fallbackName).replace(/[^A-Za-z0-9.]/g, '').slice(0, 10);
  const extension = extensionOverride
    ? normalizeWorkbookExtension(extensionOverride)
    : originalExtension;
  const baseName = path.basename(fallbackName, originalExtension).replace(/[^A-Za-z0-9._ -]/g, '_').trim() || 'upload';
  const maxBaseLength = Math.max(1, 200 - extension.length);

  return `${baseName.slice(0, maxBaseLength)}${extension}`.slice(0, 200);
};

const createExcelUpload = () =>
  multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
      if (EXCEL_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
        cb(null, true);
        return;
      }

      cb(new AppError('Only Excel workbook uploads are allowed', 415, 'INVALID_FILE_TYPE'));
    },
  });

const validateFileMagicBytes = async (buffer) => {
  const sample = Buffer.from(buffer.subarray(0, Math.min(buffer.length, MAGIC_BYTE_SAMPLE_SIZE)));
  const detectedType = await FileType.fromBuffer(sample);
  const isOleSpreadsheet = startsWithSignature(sample, XLS_SIGNATURE);
  const isZipSpreadsheet = isZipSignature(sample);

  const acceptedByFileType = detectedType
    && (
      ['xlsx', 'xls'].includes(String(detectedType.ext || '').toLowerCase())
      || EXCEL_MIME_TYPES.has(String(detectedType.mime || '').toLowerCase())
      || String(detectedType.mime || '').toLowerCase() === 'application/zip'
    );

  if (acceptedByFileType || isOleSpreadsheet || isZipSpreadsheet) {
    return {
      detectedExt: detectedType?.ext || (isOleSpreadsheet ? 'xls' : 'xlsx'),
      detectedMime: detectedType?.mime || (isOleSpreadsheet
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    };
  }

  throw new AppError('Uploaded file signature is not a valid Excel workbook', 415, 'INVALID_FILE_SIGNATURE');
};

const parseWorkbook = (buffer) => {
  try {
    return xlsx.read(buffer, { type: 'buffer', dense: true });
  } catch (error) {
    throw new AppError('Uploaded file is not a readable Excel workbook', 415, 'INVALID_WORKBOOK');
  }
};

const countWorkbookRows = (workbook) => {
  return workbook.SheetNames.reduce((totalRows, sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return totalRows;
    }

    const rows = xlsx.utils.sheet_to_json(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
    });

    return totalRows + Math.max(0, rows.length - 1);
  }, 0);
};

const scanFileWithHook = async (file, sanitizedFileName) => {
  const scanHookUrl = String(process.env.SCAN_HOOK_URL || '').trim();
  if (!scanHookUrl) {
    return;
  }

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' }),
    sanitizedFileName
  );

  const response = await fetch(scanHookUrl, {
    method: 'POST',
    body: formData,
  });

  if (response.status !== 200) {
    throw new AppError('Upload rejected by malware scanner', 422, 'SCAN_REJECTED');
  }
};

const validateUploadedWorkbook = async (file) => {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new AppError('No file uploaded', 400, 'NO_FILE');
  }

  const { detectedExt } = await validateFileMagicBytes(file.buffer);
  const sanitizedFileName = sanitizeFilename(file.originalname, detectedExt);
  const workbook = parseWorkbook(file.buffer);

  await scanFileWithHook(file, sanitizedFileName);

  const rowCount = countWorkbookRows(workbook);
  if (rowCount > MAX_ROW_COUNT) {
    throw new AppError(
      `Excel row count exceeds ${MAX_ROW_COUNT} rows`,
      422,
      'ROW_LIMIT_EXCEEDED',
      { rowCount, maxRows: MAX_ROW_COUNT }
    );
  }

  return {
    sanitizedFileName,
    rowCount,
  };
};

module.exports = {
  MAX_ROW_COUNT,
  MAX_UPLOAD_SIZE_MB,
  createExcelUpload,
  countWorkbookRows,
  parseWorkbook,
  sanitizeFilename,
  validateFileMagicBytes,
  validateUploadedWorkbook,
};
