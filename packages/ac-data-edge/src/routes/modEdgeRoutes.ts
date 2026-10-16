import { Router, raw } from 'express';
import { hubOrAdminAuth } from '../middleware/hubOrAdminAuth.js';
import { isModPeerRequestAuthorized } from '@projectd/ac-data-shared/services/hud/hudWorkerAuth.js';
import { handleServeModBlob, handleDeleteLocalContent } from '../services/modAgent/localModUpload.js';
import { handleAdoptLocalFolder, handleGcModBlobs } from '../services/modAgent/adoptLocalFolder.js';
import {
  handleServeContentTree,
  handleInstallContentTree,
} from '../services/modAgent/contentTreeSync.js';
import {
  handleSlimUploadPlan,
  handleSlimUploadPut,
  handleSlimUploadCommit,
} from '../services/modAgent/slimUploadSession.js';

function workerAuth(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  if (!isModPeerRequestAuthorized(req)) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  next();
}

/** Mount under /admin — fleet hub proxies with X-Worker-Secret. */
export const modLocalUploadRouter = Router();
modLocalUploadRouter.post('/mods/adopt', hubOrAdminAuth, (req, res) => {
  void handleAdoptLocalFolder(req, res);
});
modLocalUploadRouter.post('/mods/gc-blobs', hubOrAdminAuth, (req, res) => {
  void handleGcModBlobs(req, res);
});
modLocalUploadRouter.delete('/mods/local-content/:kind/:slug', hubOrAdminAuth, (req, res) => {
  void handleDeleteLocalContent(req, res);
});
modLocalUploadRouter.post('/mods/slim-upload/plan', hubOrAdminAuth, (req, res) => {
  void handleSlimUploadPlan(req, res);
});
modLocalUploadRouter.put(
  '/mods/slim-upload/file',
  hubOrAdminAuth,
  raw({ type: '*/*', limit: Number(process.env.MOD_SLIM_UPLOAD_MAX_FILE_BYTES || 64 * 1024 * 1024) }),
  (req, res) => {
    void handleSlimUploadPut(req, res);
  },
);
modLocalUploadRouter.post('/mods/slim-upload/commit', hubOrAdminAuth, (req, res) => {
  void handleSlimUploadCommit(req, res);
});

/** Mount under /api — peer edges pull blobs (legacy) or content trees (folder-first). */
export const modBlobRouter = Router();
modBlobRouter.get('/mod-agent/v1/blobs/:sha256', workerAuth, (req, res) => {
  void handleServeModBlob(req, res);
});
modBlobRouter.get('/mod-agent/v1/trees/:kind/:slug', workerAuth, (req, res) => {
  void handleServeContentTree(req, res);
});
modBlobRouter.post('/mod-agent/v1/trees/install', workerAuth, (req, res) => {
  void handleInstallContentTree(req, res);
});
