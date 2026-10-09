/**
 * Hub-only client launcher routes (HUD zip metadata + downloads).
 * Mount on ac-data-backend at `/client`. Edge does not serve these —
 * players download overlays from the hub (`PROJECTD_HUD_PATH`).
 */
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
