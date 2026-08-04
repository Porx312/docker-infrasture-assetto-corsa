import { Router } from 'express';
import {
  downloadContentHandler,
  downloadHudFileHandler,
  downloadHudLatestHandler,
  downloadLauncherFileHandler,
  downloadLauncherLatestHandler,
  getActiveServersHandler,
  getBootstrapHandler,
  getContentManifestHandler,
  getHudLatestHandler,
  getLauncherLatestHandler,
  headContentDownloadHandler,
} from '../controller/clientSyncController.js';

const router = Router();

router.get('/bootstrap', getBootstrapHandler);
router.get('/servers', getActiveServersHandler);

router.get('/hud/latest', getHudLatestHandler);
router.get('/hud/download', downloadHudLatestHandler);
router.get('/hud/download/:filename', downloadHudFileHandler);

router.get('/launcher/latest', getLauncherLatestHandler);
router.get('/launcher/download', downloadLauncherLatestHandler);
router.get('/launcher/download/:filename', downloadLauncherFileHandler);

router.get('/content/manifest', getContentManifestHandler);
router.head('/content/:type/:name/download', headContentDownloadHandler);
router.get('/content/:type/:name/download', downloadContentHandler);

export default router;
