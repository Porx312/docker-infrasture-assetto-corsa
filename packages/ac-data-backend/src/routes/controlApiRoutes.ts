import { Router } from 'express';
import {
  ensureInstanceModsHandler,
  getAgentPresenceHandler,
  getCentralModBySlugHandler,
  getInstanceModsCarsHandler,
  getInstanceModsTracksHandler,
  getLiveSummaryHandler,
  getModsAvailabilityHandler,
  getServerLiveHandler,
  listCentralModsHandler,
  postAgentHeartbeatHandler,
  postAgentModsHandler,
  postAgentRegisterHandler,
  postDesiredConfigHandler,
  postHostCatalogSyncServersHandler,
} from '../controller/controlApiController.js';

const router = Router();

router.post('/agents/register', (req, res) => {
  void postAgentRegisterHandler(req, res);
});
router.post('/agents/heartbeat', (req, res) => {
  void postAgentHeartbeatHandler(req, res);
});
router.get('/agents/:instanceId', (req, res) => {
  void getAgentPresenceHandler(req, res);
});

router.get('/live/summary', (req, res) => {
  void getLiveSummaryHandler(req, res);
});

router.post('/agents/:instanceId/mods', (req, res) => {
  void postAgentModsHandler(req, res);
});

// Central library (Postgres catalog)
router.get('/mods/availability', (req, res) => {
  void getModsAvailabilityHandler(req, res);
});
router.get('/mods', (req, res) => {
  void listCentralModsHandler(req, res);
});
router.get('/mods/:slug', (req, res) => {
  void getCentralModBySlugHandler(req, res);
});

// Legacy LOCAL CONTENT / INVENTORY (Redis disk scan)
router.get('/instances/:instanceId/mods/cars', (req, res) => {
  void getInstanceModsCarsHandler(req, res);
});
router.get('/instances/:instanceId/mods/tracks', (req, res) => {
  void getInstanceModsTracksHandler(req, res);
});
router.post('/instances/:instanceId/mods/ensure', (req, res) => {
  void ensureInstanceModsHandler(req, res);
});

router.post('/internal/desired-config', (req, res) => {
  void postDesiredConfigHandler(req, res);
});
router.post('/internal/host-catalog/sync-servers', (req, res) => {
  void postHostCatalogSyncServersHandler(req, res);
});

// Live roster by lobby name (not server_slots)
router.get('/servers/:serverId/live', (req, res) => {
  void getServerLiveHandler(req, res);
});

export default router;
