import { Router } from 'express';
import {
  downloadContentHandler,
  downloadHudFileHandler,
  downloadHudLatestHandler,
  getBootstrapHandler,
  getContentManifestHandler,
  getHudLatestHandler,
} from '../controller/clientSyncController.js';

const router = Router();

router.get('/bootstrap', getBootstrapHandler);

router.get('/hud/latest', getHudLatestHandler);
router.get('/hud/download', downloadHudLatestHandler);
router.get('/hud/download/:filename', downloadHudFileHandler);

router.get('/content/manifest', getContentManifestHandler);
router.get('/content/:type/:name/download', downloadContentHandler);

export default router;
