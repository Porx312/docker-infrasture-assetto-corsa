import { Router } from 'express';
import {
  downloadHudFileHandler,
  downloadHudLatestHandler,
  getBootstrapHandler,
  getHudLatestHandler,
} from '../controller/clientSyncController.js';

const router = Router();

router.get('/bootstrap', getBootstrapHandler);

router.get('/hud/latest', getHudLatestHandler);
router.get('/hud/download', downloadHudLatestHandler);
router.get('/hud/download/:filename', downloadHudFileHandler);

export default router;
