# Batch Processing Guide

This document replaces the scattered root-level notes for batch uploads and hybrid worker behavior.

## Current Entry Points

- API upload endpoint: `POST /api/v1/batch/encode`
- Batch status endpoint: `GET /api/v1/batch/status/:jobId`
- Batch result download: `GET /api/v1/batch/download/:jobId`
- Territory visualization: `GET /api/v1/batch/territories/visualization`
- Branch upload endpoint: `POST /api/v1/branches/upload`

## Runtime Dependencies

- Redis-backed queues for background work
- Backend worker startup in normal app execution
- Optional Python worker flow for larger uploads

## Local Checks

- Use the frontend and backend verification commands from [operations.md](operations.md)
- Use the root helper scripts when you need to inspect queue or batch state

## Archived Notes

Detailed implementation notes, troubleshooting logs, and previous rollout summaries were moved to [history/README.md](history/README.md). That archive includes the old hybrid architecture, troubleshooting, upload fix, and testing writeups.
