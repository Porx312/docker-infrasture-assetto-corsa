import { Router } from 'express';
import {
  configureServer,
  getServers,
  restartServer,
  startServer,
  stopServer,
} from '../controller/serverHttpController.js';

const router = Router();

router.get('/servers', getServers);
router.post('/servers/:serverName/start', startServer);
router.post('/servers/:serverName/stop', stopServer);
router.post('/servers/:serverName/restart', restartServer);
router.post('/servers/:serverName/config', configureServer);

export default router;
