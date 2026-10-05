import { Router } from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { adminAuth } from '../middleware/adminAuth.js';
import {
  listModsHandler,
  listModArtifactsHandler,
  modDistributeHandler,
  modDistributionMatrixHandler,
  modResyncHandler,
  modVerifyHandler,
  modRemoveFromEdgesHandler,
  listModEdgesHandler,
  disableModEdgeHandler,
  listFleetSyncIssuesHandler,
  modGcListHandler,
  modGcRunHandler,
  serverModReadinessHandler,
  serverModRefreshHandler,
  serverModSyncMissingHandler,
  modPreviewImageUploadHandler,
  modPreviewImageDeleteHandler,
  modDeletePackageHandler,
  modUpdatePackageHandler,
  modEdgeInventoryHandler,
  modEdgeUploadHandler,
} from '../controller/modController.js';
import { ensureModStagingDir } from '../services/mods/modPaths.js';

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        cb(null, ensureModStagingDir());
      } catch (err) {
        cb(err instanceof Error ? err : new Error(String(err)), '');
      }
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`);
    },
  }),
  limits: { fileSize: Number(process.env.MOD_UPLOAD_MAX_BYTES || 10 * 1024 * 1024 * 1024) },
});

const previewUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, process.env.ADMIN_UPLOAD_DIR || os.tmpdir());
    },
    filename: (_req, file, cb) => {
      cb(null, `mod-preview-${Date.now()}${path.extname(file.originalname) || '.jpg'}`);
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(null, ok);
  },
});

router.get('/mods', adminAuth, listModsHandler);
router.get('/mods/edges', adminAuth, listModEdgesHandler);
router.get('/mods/edges/:edgeId/inventory', adminAuth, (req, res) => {
  void modEdgeInventoryHandler(req, res);
});
router.post(
  '/mods/edges/:edgeId/upload',
  adminAuth,
  upload.single('file'),
  (req, res) => {
    void modEdgeUploadHandler(req, res);
  },
);
router.get('/mods/fleet/sync-issues', adminAuth, (req, res) => {
  void listFleetSyncIssuesHandler(req, res);
});
router.patch('/mods/edges/:edgeId', adminAuth, disableModEdgeHandler);
router.get('/mods/packages/:packageId/artifacts', adminAuth, listModArtifactsHandler);
router.patch('/mods/packages/:packageId', adminAuth, (req, res) => {
  void modUpdatePackageHandler(req, res);
});
router.delete('/mods/packages/:packageId', adminAuth, (req, res) => {
  void modDeletePackageHandler(req, res);
});
router.post(
  '/mods/:packageId/preview-image',
  adminAuth,
  previewUpload.single('file'),
  (req, res) => {
    void modPreviewImageUploadHandler(req, res);
  },
);
router.delete('/mods/:packageId/preview-image', adminAuth, (req, res) => {
  void modPreviewImageDeleteHandler(req, res);
});
router.get('/mods/artifacts/:artifactId/distribution', adminAuth, modDistributionMatrixHandler);
router.post('/mods/artifacts/:artifactId/distribute', adminAuth, modDistributeHandler);
router.post('/mods/artifacts/:artifactId/resync', adminAuth, modResyncHandler);
router.post('/mods/artifacts/:artifactId/verify', adminAuth, modVerifyHandler);
router.post('/mods/artifacts/:artifactId/remove-from-edges', adminAuth, modRemoveFromEdgesHandler);
router.get('/mods/gc/candidates', adminAuth, modGcListHandler);
router.post('/mods/gc/run', adminAuth, modGcRunHandler);

router.get('/servers/:name/mods/readiness', adminAuth, serverModReadinessHandler);
router.post('/servers/:name/mods/refresh', adminAuth, serverModRefreshHandler);
router.post('/servers/:name/mods/sync-missing', adminAuth, serverModSyncMissingHandler);

export default router;
