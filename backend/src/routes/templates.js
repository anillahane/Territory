const express = require('express');
const xlsx = require('xlsx');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * GET /api/v1/templates/batch-processing
 * Download sample template for batch processing
 */
router.get(
  '/batch-processing',
  asyncHandler(async (req, res) => {
    // Sample data with customer-specific columns
    const sampleData = [
      {
        'lan': 'Customer001',
        'canon_lat': 19.0760,
        'canon_long': 72.8777,
        'branch_code': 'BR001',
      },
      {
        'lan': 'Customer002',
        'canon_lat': 28.7041,
        'canon_long': 77.1025,
        'branch_code': 'BR002',
      },
      {
        'lan': 'Customer003',
        'canon_lat': 12.9716,
        'canon_long': 77.5946,
        'branch_code': 'BR003',
      },
      {
        'lan': 'Customer004',
        'canon_lat': 13.0827,
        'canon_long': 80.2707,
        'branch_code': 'BR004',
      },
      {
        'lan': 'Customer005',
        'canon_lat': 22.5726,
        'canon_long': 88.3639,
        'branch_code': 'BR005',
      },
    ];

    // Create worksheet
    const worksheet = xlsx.utils.json_to_sheet(sampleData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 20 }, // lan
      { wch: 12 }, // canon_lat
      { wch: 12 }, // canon_long
      { wch: 14 }, // branch_code
    ];

    // Create workbook
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Customer Data');

    // Add instructions sheet
    const instructions = [
      {
        'Step': '1',
        'Instruction': 'Fill in your customer data in the "Customer Data" sheet',
      },
      {
        'Step': '2',
        'Instruction': 'Required columns: lan (customer ID), canon_lat (latitude), canon_long (longitude), branch_code',
      },
      {
        'Step': '3',
        'Instruction': 'Alternative column names also accepted: Latitude/latitude/Lat/lat for latitude',
      },
      {
        'Step': '4',
        'Instruction': 'Alternative column names also accepted: Longitude/longitude/Lon/lon for longitude',
      },
      {
        'Step': '5',
        'Instruction': 'canon_lat must be between -90 and 90',
      },
      {
        'Step': '6',
        'Instruction': 'canon_long must be between -180 and 180',
      },
      {
        'Step': '7',
        'Instruction': 'branch_code should match an existing branch ID when provided',
      },
      {
        'Step': '8',
        'Instruction': 'Upload the file to get Pocket IDs for each customer',
      },
      {
        'Step': '9',
        'Instruction': 'Result will include: PocketID, Distance to Pocket Center, and Pocket Center coordinates',
      },
    ];

    const instructionsSheet = xlsx.utils.json_to_sheet(instructions);
    instructionsSheet['!cols'] = [
      { wch: 8 },  // Step
      { wch: 80 }, // Instruction
    ];
    xlsx.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

    // Generate buffer
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=customer_batch_template.xlsx'
    );
    res.send(buffer);
  })
);

/**
 * GET /api/v1/templates/branch-upload
 * Download sample template for branch upload
 */
router.get(
  '/branch-upload',
  asyncHandler(async (req, res) => {
    // Sample data
    const sampleData = [
      {
        'ID': 'BR001',
        'City': 'Mumbai',
        'Latitude': 19.0760,
        'Longitude': 72.8777,
      },
      {
        'ID': 'BR002',
        'City': 'Delhi',
        'Latitude': 28.7041,
        'Longitude': 77.1025,
      },
      {
        'ID': 'BR003',
        'City': 'Bangalore',
        'Latitude': 12.9716,
        'Longitude': 77.5946,
      },
      {
        'ID': 'BR004',
        'City': 'Chennai',
        'Latitude': 13.0827,
        'Longitude': 80.2707,
      },
      {
        'ID': 'BR005',
        'City': 'Kolkata',
        'Latitude': 22.5726,
        'Longitude': 88.3639,
      },
    ];

    // Create worksheet
    const worksheet = xlsx.utils.json_to_sheet(sampleData);

    // Set column widths
    worksheet['!cols'] = [
      { wch: 10 }, // ID
      { wch: 20 }, // City
      { wch: 12 }, // Latitude
      { wch: 12 }, // Longitude
    ];

    // Create workbook
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Branches');

    // Add instructions sheet
    const instructions = [
      {
        'Step': '1',
        'Instruction': 'Fill in your branch data in the "Branches" sheet',
      },
      {
        'Step': '2',
        'Instruction': 'Required columns: ID, City, Latitude, Longitude (case-insensitive)',
      },
      {
        'Step': '3',
        'Instruction': 'ID must be unique for each branch',
      },
      {
        'Step': '4',
        'Instruction': 'City can be any text (branch name or location)',
      },
      {
        'Step': '5',
        'Instruction': 'Latitude must be between -90 and 90',
      },
      {
        'Step': '6',
        'Instruction': 'Longitude must be between -180 and 180',
      },
      {
        'Step': '7',
        'Instruction': 'Upload the file to add branches to the system',
      },
      {
        'Step': '8',
        'Instruction': 'Pocket IDs will be automatically calculated',
      },
    ];

    const instructionsSheet = xlsx.utils.json_to_sheet(instructions);
    instructionsSheet['!cols'] = [
      { wch: 8 },  // Step
      { wch: 70 }, // Instruction
    ];
    xlsx.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');

    // Generate buffer
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename=branch_upload_template.xlsx'
    );
    res.send(buffer);
  })
);

module.exports = router;
