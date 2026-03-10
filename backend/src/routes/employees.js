const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const { query } = require('../config/database');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

const router = express.Router();
const AUTO_EMPLOYEE_COLOR_SEQUENCE = [
  '#D50711', // Red
  '#10B981', // Green
  '#8B4513', // Brown
  '#B8860B', // Dark Yellow
  '#000000', // Black
  '#FFFFFF'  // White
];
const DEFAULT_EMPLOYEE_COLOR = AUTO_EMPLOYEE_COLOR_SEQUENCE[0];
const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '10', 10) * 1024 * 1024
  }
});

const parseBooleanFlag = (value, defaultValue = true) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
};

const normalizeColorCode = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return DEFAULT_EMPLOYEE_COLOR;
  }

  if (!HEX_COLOR_REGEX.test(normalized)) {
    throw new AppError('color_code must be a valid hex color like #D50711', 400, 'INVALID_COLOR_CODE');
  }

  return normalized.toUpperCase();
};

const parseOptionalColorCode = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  if (!HEX_COLOR_REGEX.test(normalized)) {
    throw new AppError('color_code must be a valid hex color like #D50711', 400, 'INVALID_COLOR_CODE');
  }

  return normalized.toUpperCase();
};

const fetchBranchEmployeeCount = async (branchId) => {
  const countResult = await query(
    `
      SELECT COUNT(*)::int AS total
      FROM branch_employees
      WHERE branch_id = $1
    `,
    [branchId]
  );

  return Number(countResult.rows[0]?.total || 0);
};

const resolveAutoColorByIndex = (index) => {
  const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
  return AUTO_EMPLOYEE_COLOR_SEQUENCE[safeIndex % AUTO_EMPLOYEE_COLOR_SEQUENCE.length];
};

const resolveNextAutoColorForBranch = async (branchId) => {
  const currentCount = await fetchBranchEmployeeCount(branchId);
  return resolveAutoColorByIndex(currentCount);
};

const normalizeMaxCapacity = (value, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new AppError('max_capacity is required', 400, 'MISSING_MAX_CAPACITY');
    }
    return null;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new AppError('max_capacity must be a non-negative integer', 400, 'INVALID_MAX_CAPACITY');
  }

  return parsed;
};

// --- ORIGINAL BACKUP ---
// const mapEmployeeRow = (row) => ({
//   id: String(row.id),
//   branchId: String(row.branch_id),
//   employeeId: String(row.employee_id),
//   name: String(row.name || ''),
//   colorCode: String(row.color_code || DEFAULT_EMPLOYEE_COLOR).toUpperCase(),
//   maxCapacity: row.max_capacity === null ? null : Number(row.max_capacity),
//   isActive: Boolean(row.is_active)
// });
const mapEmployeeRow = (row) => ({
  id: String(row.id),
  branchId: String(row.branch_id),
  employeeId: String(row.employee_id),
  name: String(row.name || ''),
  colorCode: String(row.color_code || DEFAULT_EMPLOYEE_COLOR).toUpperCase(),
  maxCapacity: row.max_capacity === null ? null : Number(row.max_capacity),
  isActive: Boolean(row.is_active),
  allocatedPocketsCount: Number(row.allocated_pockets_count || 0),
  allocatedCustomerCount: Number(row.allocated_customer_count || 0)
});

const getFirstDefinedValue = (row, aliases) => {
  for (const alias of aliases) {
    if (!Object.prototype.hasOwnProperty.call(row, alias)) {
      continue;
    }
    const value = row[alias];
    if (value === undefined || value === null) {
      continue;
    }
    const normalized = String(value).trim();
    if (!normalized) {
      continue;
    }
    return value;
  }
  return undefined;
};

const parseRowsFromUpload = (req) => {
  if (req.file?.buffer) {
    const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
    if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0) {
      throw new AppError('Uploaded file does not contain any sheets.', 400, 'INVALID_EMPLOYEE_UPLOAD_FILE');
    }
    const firstSheetName = workbook.SheetNames[0];
    return xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: null });
  }

  if (Array.isArray(req.body?.rows)) {
    return req.body.rows;
  }

  return [];
};

const fetchEmployeeById = async (id) => {
  const employeeResult = await query(
    `
      SELECT
        id::int AS id,
        branch_id,
        employee_id,
        name,
        color_code,
        max_capacity,
        is_active
      FROM branch_employees
      WHERE id = $1::int
      LIMIT 1
    `,
    [id]
  );

  if (employeeResult.rows.length === 0) {
    throw new AppError('Employee not found', 404, 'EMPLOYEE_NOT_FOUND');
  }

  return employeeResult.rows[0];
};

/**
 * GET /api/v1/employees/branch/:branchId
 * Fetch all employees for a branch.
 */
router.get(
  '/branch/:branchId',
  asyncHandler(async (req, res) => {
    const branchId = String(req.params.branchId || '').trim();
    if (!branchId) {
      throw new AppError('Branch ID is required', 400, 'MISSING_BRANCH_ID');
    }

    const includeInactive = parseBooleanFlag(req.query?.includeInactive, true);

    const branchResult = await query(
      'SELECT id, city FROM branches WHERE id = $1',
      [branchId]
    );
    if (branchResult.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    // --- ORIGINAL BACKUP ---
    // const employeesResult = await query(
    //   `
    //     SELECT
    //       id::int AS id,
    //       branch_id,
    //       employee_id,
    //       COALESCE(
    //         NULLIF(btrim(name), ''),
    //         NULLIF(btrim(employee_name), ''),
    //         employee_id
    //       )::text AS name,
    //       CASE
    //         WHEN color_code ~ '^#[0-9A-Fa-f]{6}$' THEN upper(color_code)
    //         ELSE $2
    //       END AS color_code,
    //       max_capacity,
    //       is_active
    //     FROM branch_employees
    //     WHERE branch_id = $1
    //       AND ($3::boolean = TRUE OR is_active = TRUE)
    //     ORDER BY id
    //   `,
    //   [branchId, DEFAULT_EMPLOYEE_COLOR, includeInactive]
    // );
    const employeesResult = await query(
      `
        SELECT
          id::int AS id,
          branch_id,
          employee_id,
          COALESCE(
            NULLIF(btrim(name), ''),
            NULLIF(btrim(employee_name), ''),
            employee_id
          )::text AS name,
          CASE
            WHEN color_code ~ '^#[0-9A-Fa-f]{6}$' THEN upper(color_code)
            ELSE $2
          END AS color_code,
          max_capacity,
          is_active,
          COALESCE(jsonb_array_length(allocated_pockets), 0)::int AS allocated_pockets_count,
          COALESCE(allocated_customer_count, 0)::int AS allocated_customer_count
        FROM branch_employees
        WHERE branch_id = $1
          AND ($3::boolean = TRUE OR is_active = TRUE)
        ORDER BY id
      `,
      [branchId, DEFAULT_EMPLOYEE_COLOR, includeInactive]
    );

    res.json({
      branchId,
      branchCity: branchResult.rows[0].city || '',
      employees: employeesResult.rows.map(mapEmployeeRow)
    });
  })
);

/**
 * POST /api/v1/employees
 * Create a new branch employee.
 */
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const branchId = String(req.body?.branch_id || '').trim();
    const employeeId = String(req.body?.employee_id || '').trim();
    const name = String(req.body?.name || '').trim();
    const requestedColorCode = parseOptionalColorCode(req.body?.color_code);
    const maxCapacity = normalizeMaxCapacity(req.body?.max_capacity);
    const isActive = parseBooleanFlag(req.body?.is_active, true);

    if (!branchId) {
      throw new AppError('branch_id is required', 400, 'MISSING_BRANCH_ID');
    }
    if (!employeeId) {
      throw new AppError('employee_id is required', 400, 'MISSING_EMPLOYEE_ID');
    }
    if (!name) {
      throw new AppError('name is required', 400, 'MISSING_EMPLOYEE_NAME');
    }

    const branchResult = await query(
      'SELECT id FROM branches WHERE id = $1',
      [branchId]
    );
    if (branchResult.rows.length === 0) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }

    const colorCode = requestedColorCode || await resolveNextAutoColorForBranch(branchId);

    try {
      const createdResult = await query(
        `
          INSERT INTO branch_employees (
            branch_id,
            employee_id,
            employee_name,
            name,
            color_code,
            max_capacity,
            is_active
          )
          VALUES (
            $1::varchar,
            $2::varchar,
            $3::varchar,
            $3::varchar,
            $4::varchar,
            $5::integer,
            $6::boolean
          )
          RETURNING
            id::int AS id,
            branch_id,
            employee_id,
            name,
            color_code,
            max_capacity,
            is_active
        `,
        [branchId, employeeId, name, colorCode, maxCapacity, isActive]
      );

      res.status(201).json({
        employee: mapEmployeeRow(createdResult.rows[0])
      });
    } catch (error) {
      if (error && error.code === '23505') {
        throw new AppError(
          'Employee ID already exists for this branch.',
          409,
          'EMPLOYEE_ALREADY_EXISTS'
        );
      }
      throw error;
    }
  })
);

/**
 * POST /api/v1/employees/bulk
 * Bulk upsert employees from uploaded Excel file or JSON rows.
 */
router.post(
  '/bulk',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const fallbackBranchId = String(req.body?.branch_id || req.query?.branch_id || '').trim();
    const rows = parseRowsFromUpload(req);

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new AppError(
        'Upload must include at least one employee row.',
        400,
        'EMPTY_EMPLOYEE_UPLOAD'
      );
    }

    const summary = {
      totalRows: rows.length,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0
    };

    const errors = [];
    const maxErrorRows = 50;
    const branchEmployeeColorCache = new Map();
    const branchColorCursor = new Map();

    const ensureBranchEmployeeColorCache = async (branchId) => {
      const normalizedBranchId = String(branchId || '').trim();
      if (!normalizedBranchId) {
        return new Map();
      }

      if (branchEmployeeColorCache.has(normalizedBranchId)) {
        return branchEmployeeColorCache.get(normalizedBranchId);
      }

      const existingEmployeesResult = await query(
        `
          SELECT employee_id::text AS employee_id, upper(color_code)::text AS color_code
          FROM branch_employees
          WHERE branch_id = $1
          ORDER BY id
        `,
        [normalizedBranchId]
      );

      const employeeColorMap = new Map();
      existingEmployeesResult.rows.forEach((employeeRow) => {
        const employeeCode = String(employeeRow.employee_id || '').trim();
        const colorCode = String(employeeRow.color_code || '').trim().toUpperCase();
        if (employeeCode) {
          employeeColorMap.set(employeeCode, colorCode);
        }
      });

      branchEmployeeColorCache.set(normalizedBranchId, employeeColorMap);
      branchColorCursor.set(normalizedBranchId, employeeColorMap.size);
      return employeeColorMap;
    };

    const getNextBulkAutoColor = async (branchId) => {
      const normalizedBranchId = String(branchId || '').trim();
      await ensureBranchEmployeeColorCache(normalizedBranchId);
      const cursor = Number(branchColorCursor.get(normalizedBranchId) || 0);
      const nextColor = resolveAutoColorByIndex(cursor);
      branchColorCursor.set(normalizedBranchId, cursor + 1);
      return nextColor;
    };

    const advanceBulkColorCursor = async (branchId) => {
      const normalizedBranchId = String(branchId || '').trim();
      await ensureBranchEmployeeColorCache(normalizedBranchId);
      const cursor = Number(branchColorCursor.get(normalizedBranchId) || 0);
      branchColorCursor.set(normalizedBranchId, cursor + 1);
    };

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index] || {};
      const rowNumber = index + 2; // Header row + 1-based display

      const branchId = String(
        getFirstDefinedValue(row, ['branch_id', 'branchId', 'Branch ID', 'BranchId', 'branch'])
        || fallbackBranchId
        || ''
      ).trim();
      const employeeId = String(
        getFirstDefinedValue(row, ['employee_id', 'employeeId', 'Employee ID', 'EmployeeId', 'emp_id'])
        || ''
      ).trim();
      const name = String(
        getFirstDefinedValue(row, ['name', 'employee_name', 'employeeName', 'Employee Name'])
        || ''
      ).trim();
      const colorCandidate = getFirstDefinedValue(
        row,
        ['color_code', 'colorCode', 'Color', 'color']
      );
      const maxCapacityCandidate = getFirstDefinedValue(
        row,
        ['max_capacity', 'maxCapacity', 'Max Capacity', 'capacity']
      );
      const isActiveCandidate = getFirstDefinedValue(
        row,
        ['is_active', 'isActive', 'Active']
      );

      if (!branchId || !employeeId || !name) {
        summary.failed += 1;
        if (errors.length < maxErrorRows) {
          errors.push({
            row: rowNumber,
            message: 'branch_id, employee_id, and name are required.'
          });
        }
        continue;
      }

      try {
        const existingEmployeeColorMap = await ensureBranchEmployeeColorCache(branchId);
        const existingColorCode = existingEmployeeColorMap.get(employeeId) || null;
        const requestedColorCode = parseOptionalColorCode(colorCandidate);
        let usedAutoColor = false;
        let colorCode = requestedColorCode || existingColorCode;
        if (!colorCode) {
          colorCode = await getNextBulkAutoColor(branchId);
          usedAutoColor = true;
        }
        const maxCapacity = normalizeMaxCapacity(maxCapacityCandidate);
        const isActive = parseBooleanFlag(isActiveCandidate, true);

        const upsertResult = await query(
          `
            INSERT INTO branch_employees (
              branch_id,
              employee_id,
              employee_name,
              name,
              color_code,
              max_capacity,
              is_active
            )
            VALUES (
              $1::varchar,
              $2::varchar,
              $3::varchar,
              $3::varchar,
              $4::varchar,
              $5::integer,
              $6::boolean
            )
            ON CONFLICT (branch_id, employee_id)
            DO UPDATE SET
              employee_name = EXCLUDED.employee_name,
              name = EXCLUDED.name,
              color_code = EXCLUDED.color_code,
              max_capacity = EXCLUDED.max_capacity,
              is_active = EXCLUDED.is_active,
              updated_at = CURRENT_TIMESTAMP
            RETURNING (xmax = 0) AS inserted
          `,
          [branchId, employeeId, name, colorCode, maxCapacity, isActive]
        );

        if (upsertResult.rows.length === 0) {
          summary.skipped += 1;
          continue;
        }

        const inserted = Boolean(upsertResult.rows[0].inserted);
        if (inserted) {
          summary.created += 1;
          if (!usedAutoColor) {
            await advanceBulkColorCursor(branchId);
          }
        } else {
          summary.updated += 1;
        }

        existingEmployeeColorMap.set(employeeId, colorCode);
      } catch (error) {
        summary.failed += 1;
        if (errors.length < maxErrorRows) {
          if (error && error.code === '23503') {
            errors.push({
              row: rowNumber,
              message: `Branch ${branchId} does not exist.`
            });
          } else if (error && error.code === '23514') {
            errors.push({
              row: rowNumber,
              message: `Invalid field format (color/max_capacity) for employee ${employeeId}.`
            });
          } else {
            errors.push({
              row: rowNumber,
              message: error.message || 'Unknown insert error'
            });
          }
        }
      }
    }

    res.json({
      summary,
      errors,
      hasErrors: errors.length > 0
    });
  })
);

/**
 * GET /api/v1/employees/template
 * Download bulk upload template.
 */
router.get(
  '/template',
  asyncHandler(async (req, res) => {
    const workbook = xlsx.utils.book_new();
    const rows = [
      {
        branch_id: '235',
        employee_id: 'emp_001',
        name: 'Employee One',
        color_code: '#D50711',
        max_capacity: 120,
        is_active: true
      },
      {
        branch_id: '235',
        employee_id: 'emp_002',
        name: 'Employee Two',
        color_code: '#10B981',
        max_capacity: 120,
        is_active: true
      },
      {
        branch_id: '235',
        employee_id: 'emp_003',
        name: 'Employee Three',
        color_code: '#8B4513',
        max_capacity: 120,
        is_active: true
      }
    ];
    const worksheet = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'employees');
    const buffer = xlsx.write(workbook, {
      type: 'buffer',
      bookType: 'xlsx'
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=employee_mapping_template.xlsx'
    );
    res.send(buffer);
  })
);

/**
 * PUT /api/v1/employees/:id
 * Update branch employee details.
 */
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number.parseInt(String(req.params.id || ''), 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('Employee ID must be a valid integer.', 400, 'INVALID_EMPLOYEE_ID');
    }

    const existing = await fetchEmployeeById(id);

    const nextEmployeeId = req.body?.employee_id === undefined
      ? String(existing.employee_id)
      : String(req.body?.employee_id || '').trim();
    const nextName = req.body?.name === undefined
      ? String(existing.name || '')
      : String(req.body?.name || '').trim();
    const nextColorCode = req.body?.color_code === undefined
      ? normalizeColorCode(existing.color_code)
      : normalizeColorCode(req.body?.color_code);
    const nextMaxCapacity = req.body?.max_capacity === undefined
      ? (existing.max_capacity === null ? null : Number(existing.max_capacity))
      : normalizeMaxCapacity(req.body?.max_capacity);
    const nextIsActive = req.body?.is_active === undefined
      ? Boolean(existing.is_active)
      : parseBooleanFlag(req.body?.is_active, true);

    if (!nextEmployeeId) {
      throw new AppError('employee_id cannot be empty', 400, 'INVALID_EMPLOYEE_ID');
    }
    if (!nextName) {
      throw new AppError('name cannot be empty', 400, 'INVALID_EMPLOYEE_NAME');
    }

    try {
      const updatedResult = await query(
        `
          UPDATE branch_employees
          SET
            employee_id = $2::varchar,
            employee_name = $3::varchar,
            name = $3::varchar,
            color_code = $4::varchar,
            max_capacity = $5::integer,
            is_active = $6::boolean,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = $1::int
          RETURNING
            id::int AS id,
            branch_id,
            employee_id,
            name,
            color_code,
            max_capacity,
            is_active
        `,
        [id, nextEmployeeId, nextName, nextColorCode, nextMaxCapacity, nextIsActive]
      );

      if (updatedResult.rows.length === 0) {
        throw new AppError('Employee not found', 404, 'EMPLOYEE_NOT_FOUND');
      }

      res.json({
        employee: mapEmployeeRow(updatedResult.rows[0])
      });
    } catch (error) {
      if (error && error.code === '23505') {
        throw new AppError(
          'Employee ID already exists for this branch.',
          409,
          'EMPLOYEE_ALREADY_EXISTS'
        );
      }
      throw error;
    }
  })
);

/**
 * DELETE /api/v1/employees/:id
 * Soft delete employee by setting is_active = false.
 */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number.parseInt(String(req.params.id || ''), 10);
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('Employee ID must be a valid integer.', 400, 'INVALID_EMPLOYEE_ID');
    }

    const deleteResult = await query(
      `
        UPDATE branch_employees
        SET
          is_active = FALSE,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::int
        RETURNING
          id::int AS id,
          branch_id,
          employee_id,
          name,
          color_code,
          max_capacity,
          is_active
      `,
      [id]
    );

    if (deleteResult.rows.length === 0) {
      throw new AppError('Employee not found', 404, 'EMPLOYEE_NOT_FOUND');
    }

    res.json({
      deleted: true,
      employee: mapEmployeeRow(deleteResult.rows[0])
    });
  })
);

module.exports = router;
