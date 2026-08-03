import { Router } from 'express';
import {
  downloadContentHandler,
  downloadHudFileHandler,
  downloadHudLatestHandler,
  getActiveServersHandler,
  getBootstrapHandler,
  getContentManifestHandler,
  getHudLatestHandler,
  headContentDownloadHandler,
} from '../controller/clientSyncController.js';

const router = Router();

router.get('/bootstrap', getBootstrapHandler);
router.get('/servers', getActiveServersHandler);

router.get('/hud/latest', getHudLatestHandler);
router.get('/hud/download', downloadHudLatestHandler);
router.get('/hud/download/:filename', downloadHudFileHandler);

router.get('/content/manifest', getContentManifestHandler);
router.head('/content/:type/:name/download', headContentDownloadHandler);
router.get('/content/:type/:name/download', downloadContentHandler);

export default router;
