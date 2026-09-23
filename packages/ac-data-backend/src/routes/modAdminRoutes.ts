import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import { adminAuth } from '../middleware/adminAuth.js';
import {
  listModsHandler,
  listModArtifactsHandler,
  modUploadBeginHandler,
  modUploadFinalizeHandler,
  modDistributeHandler,
  modDistributionMatrixHandler,
  modResyncHandler,
  modVerifyHandler,
  modRemoveFromEdgesHandler,
  listModEdgesHandler,
  disableModEdgeHandler,
  modGcListHandler,
  modGcRunHandler,
  serverModReadinessHandler,
  serverModRefreshHandler,
  serverModSyncMissingHandler,
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

router.get('/mods', adminAuth, listModsHandler);
router.get('/mods/edges', adminAuth, listModEdgesHandler);
router.patch('/mods/edges/:edgeId', adminAuth, disableModEdgeHandler);
router.post('/mods/upload', adminAuth, upload.single('file'), modUploadBeginHandler);
router.post('/mods/upload/:uploadId/finalize', adminAuth, modUploadFinalizeHandler);
router.get('/mods/packages/:packageId/artifacts', adminAuth, listModArtifactsHandler);
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
