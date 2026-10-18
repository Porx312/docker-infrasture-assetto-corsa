import { Router, raw } from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import { adminAuth } from '@projectd/ac-data-shared/middleware/adminAuth.js';
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
  modEdgeDeleteContentHandler,
  modEdgeAdoptHandler,
  modEdgeGcBlobsHandler,
  modEdgeSlimUploadPlanHandler,
  modEdgeSlimUploadFileHandler,
  modEdgeSlimUploadCommitHandler,
  modLibrarySlimUploadPlanHandler,
  modLibrarySlimUploadFileHandler,
  modLibrarySlimUploadCommitHandler,
  modLibraryListHandler,
} from '../controller/modController.js';

const router = Router();

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
router.get('/mods/library', adminAuth, (req, res) => {
  void modLibraryListHandler(req, res);
});
router.post('/mods/library/slim-upload/plan', adminAuth, (req, res) => {
  void modLibrarySlimUploadPlanHandler(req, res);
});
router.put(
  '/mods/library/slim-upload/file',
  adminAuth,
  raw({ type: '*/*', limit: Number(process.env.MOD_SLIM_UPLOAD_MAX_FILE_BYTES || 64 * 1024 * 1024) }),
  (req, res) => {
    void modLibrarySlimUploadFileHandler(req, res);
  },
);
router.post('/mods/library/slim-upload/commit', adminAuth, (req, res) => {
  void modLibrarySlimUploadCommitHandler(req, res);
});
router.get('/mods/edges', adminAuth, listModEdgesHandler);
router.get('/mods/edges/:edgeId/inventory', adminAuth, (req, res) => {
  void modEdgeInventoryHandler(req, res);
});
router.delete('/mods/edges/:edgeId/content/:kind/:slug', adminAuth, (req, res) => {
  void modEdgeDeleteContentHandler(req, res);
});
router.post('/mods/edges/:edgeId/adopt', adminAuth, (req, res) => {
  void modEdgeAdoptHandler(req, res);
});
router.post('/mods/edges/:edgeId/slim-upload/plan', adminAuth, (req, res) => {
  void modEdgeSlimUploadPlanHandler(req, res);
});
router.put(
  '/mods/edges/:edgeId/slim-upload/file',
  adminAuth,
  raw({ type: '*/*', limit: Number(process.env.MOD_SLIM_UPLOAD_MAX_FILE_BYTES || 64 * 1024 * 1024) }),
  (req, res) => {
    void modEdgeSlimUploadFileHandler(req, res);
  },
);
router.post('/mods/edges/:edgeId/slim-upload/commit', adminAuth, (req, res) => {
  void modEdgeSlimUploadCommitHandler(req, res);
});
router.post('/mods/edges/:edgeId/gc-blobs', adminAuth, (req, res) => {
  void modEdgeGcBlobsHandler(req, res);
});
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
