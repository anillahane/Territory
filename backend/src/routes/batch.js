const express = require('express');
const fs = require('fs');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { requireRole } = require('../middleware/auth');
const { batchProcessQueue } = require('../config/queue');
const { createExcelUpload } = require('../utils/fileValidation');
const batchService = require('../services/BatchService');
const voronoiService = require('../services/VoronoiService');

const router = express.Router();
const upload = createExcelUpload();

batchProcessQueue.process(batchService.processBatchQueueJob);
batchProcessQueue.on('failed', batchService.handleBatchQueueFailure);

router.post(
  '/encode',
  requireRole('admin'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError('No file uploaded', 400, 'NO_FILE');
    }

    const result = await batchService.createBatchEncodeJob({
      file: req.file,
      body: req.body || {},
    });

    res.status(result.statusCode).json(result.payload);
  })
);

router.get(
  '/status/:jobId',
  asyncHandler(async (req, res) => {
    const status = await batchService.getBatchStatus(req.params.jobId);
    res.json(status);
  })
);

router.get(
  '/download/:jobId',
  asyncHandler(async (req, res) => {
    const downloadPayload = await batchService.getDownloadPayload(req.params.jobId);

    res.setHeader('Content-Type', downloadPayload.contentType);
    res.setHeader('Content-Disposition', `attachment; filename=${downloadPayload.fileName}`);

    if (downloadPayload.type === 'file') {
      fs.createReadStream(downloadPayload.filePath).pipe(res);
      return;
    }

    res.send(downloadPayload.buffer);
  })
);

router.get(
  '/territories/visualization',
  asyncHandler(async (req, res) => {
    const payload = await voronoiService.getTerritoryVisualization({
      mode: req.query.mode,
      customerView: req.query.customerView,
      branchIds: req.query.branchIds,
      jobId: req.query.jobId,
    });

    res.json(payload);
  })
);

router.get(
  '/territories/:jobId',
  asyncHandler(async (req, res) => {
    const payload = await voronoiService.getJobTerritories(req.params.jobId);
    res.json(payload);
  })
);

router.__testables = {
  getScopedBranchIdsFromMappings: batchService.getScopedBranchIdsFromMappings,
  resolveReplaceExistingScope: batchService.resolveReplaceExistingScope,
};

module.exports = router;
