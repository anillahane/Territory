const path = require('path');
const FileType = require('file-type');
const xlsx = require('xlsx');
const { AppError } = require('../middleware/errorHandler');

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_UPLOAD_ROWS = 100000;
const ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream'
]);
const XLSX_EXTENSIONS = new Set(['.xlsx', '.xls']);
const ALLOWED_FILE_SIGNATURES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-cfb',
  'application/vnd.ms-excel'
]);

const sanitizeUploadedFilename = (originalName) => {
  const basename = path.basename(String(originalName || '').trim());
  const withoutControlChars = basename.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_');
  const collapsed = withoutControlChars.replace(/\s+/g, ' ').trim();
  const truncated = collapsed.slice(0, 200);
  return truncated || 'upload.xlsx';
};

const getFileTypeFromBuffer = async (buffer) => FileType.fromBuffer(buffer);

const getWorkbookRowCount = (buffer) => {
  const workbook = xlsx.read(buffer, {
    type: 'buffer',
    dense: false,
    cellFormula: false,
    cellHTML: false,
    cellNF: false,
    cellStyles: false
  });

  let totalRows = 0;
  workbook.SheetNames.forEach((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const ref = worksheet?.['!ref'];
    if (!ref) {
      return;
    }
    const range = xlsx.utils.decode_range(ref);
    totalRows += Math.max((range.e.r - range.s.r), 0);
  });

  return totalRows;
};

const scanWithExternalHook = async ({ buffer, fileName, mimeType }) => {
  const scanHookUrl = String(process.env.SCAN_HOOK_URL || '').trim();
  if (!scanHookUrl) {
    return;
  }

  const response = await fetch(scanHookUrl, {
    method: 'POST',
    headers: {
      'content-type': mimeType || 'application/octet-stream',
      'x-file-name': fileName
    },
    body: buffer
  });

  if (!response.ok) {
    throw new AppError('Upload rejected by malware scanner', 422, 'SCAN_REJECTED');
  }
};

const validateUploadedExcelFile = async (file) => {
  if (!file || !Buffer.isBuffer(file.buffer)) {
    throw new AppError('No file uploaded', 400, 'NO_FILE');
  }

  const sanitizedFileName = sanitizeUploadedFilename(file.originalname);
  const extension = path.extname(sanitizedFileName).toLowerCase();
  if (!XLSX_EXTENSIONS.has(extension)) {
    throw new AppError('Only Excel uploads are supported', 415, 'INVALID_FILE_EXTENSION');
  }

  if (!ALLOWED_MIME_TYPES.has(String(file.mimetype || '').toLowerCase())) {
    throw new AppError('Unsupported upload MIME type', 415, 'INVALID_FILE_MIME');
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new AppError('Uploaded file exceeds the 10MB limit', 413, 'FILE_TOO_LARGE');
  }

  const fileType = await getFileTypeFromBuffer(file.buffer.subarray(0, 4096));
  const detectedMime = String(fileType?.mime || '').toLowerCase();
  if (!ALLOWED_FILE_SIGNATURES.has(detectedMime)) {
    throw new AppError('Uploaded file does not match a valid Excel signature', 415, 'INVALID_FILE_SIGNATURE');
  }

  await scanWithExternalHook({
    buffer: file.buffer,
    fileName: sanitizedFileName,
    mimeType: detectedMime || String(file.mimetype || '').toLowerCase()
  });

  const rowCount = getWorkbookRowCount(file.buffer);
  if (rowCount > MAX_UPLOAD_ROWS) {
    throw new AppError(
      `Uploaded workbook exceeds the ${MAX_UPLOAD_ROWS.toLocaleString()} row limit`,
      422,
      'ROW_LIMIT_EXCEEDED'
    );
  }

  return {
    sanitizedFileName,
    rowCount,
    detectedMime
  };
};

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_UPLOAD_ROWS,
  MAX_UPLOAD_SIZE_BYTES,
  sanitizeUploadedFilename,
  validateUploadedExcelFile
};
