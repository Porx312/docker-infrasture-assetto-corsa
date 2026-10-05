import { Router } from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { hubOrAdminAuth } from '../middleware/hubOrAdminAuth.js';
import { isWorkerRequestAuthorized } from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';
import {
  handleLocalModUpload,
  handleServeModBlob,
} from '../services/modAgent/localModUpload.js';

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, process.env.ADMIN_UPLOAD_DIR || os.tmpdir());
    },
    filename: (_req, file, cb) => {
      cb(null, `edge-mod-${Date.now()}${path.extname(file.originalname) || '.zip'}`);
    },
  }),
  limits: { fileSize: Number(process.env.MOD_UPLOAD_MAX_BYTES || 10 * 1024 * 1024 * 1024) },
});

function workerAuth(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (!isWorkerRequestAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  next();
}

/** Mount under /admin — fleet hub proxies with X-Worker-Secret. */
export const modLocalUploadRouter = Router();
modLocalUploadRouter.post('/mods/local-upload', hubOrAdminAuth, upload.single('file'), (req, res) => {
  void handleLocalModUpload(req, res);
});

/** Mount under /api — peer edges pull blobs. */
export const modBlobRouter = Router();
modBlobRouter.get('/mod-agent/v1/blobs/:sha256', workerAuth, (req, res) => {
  void handleServeModBlob(req, res);
});
