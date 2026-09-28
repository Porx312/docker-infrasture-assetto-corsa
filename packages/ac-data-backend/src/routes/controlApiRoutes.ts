import { Router } from 'express';
import {
  allocateServerSlotHandler,
  applyServerSlotConfigHandler,
  ensureInstanceModsHandler,
  getAgentPresenceHandler,
  getCentralModBySlugHandler,
  getInstanceModsCarsHandler,
  getInstanceModsTracksHandler,
  getLiveSummaryHandler,
  getModsAvailabilityHandler,
  getServerLiveHandler,
  getServerSlotHandler,
  listCentralModsHandler,
  listServerSlotsHandler,
  postAgentHeartbeatHandler,
  postAgentModsHandler,
  postAgentRegisterHandler,
  postDesiredConfigHandler,
  restartServerSlotHandler,
  startServerSlotHandler,
  stopServerSlotHandler,
  upsertServerSlotHandler,
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

// Central library (Postgres catalog) — register before /mods/:slug
router.get('/mods/availability', (req, res) => {
  void getModsAvailabilityHandler(req, res);
});
router.get('/mods', (req, res) => {
  void listCentralModsHandler(req, res);
});
router.get('/mods/:slug', (req, res) => {
  void getCentralModBySlugHandler(req, res);
});

// Legacy LOCAL CONTENT / INVENTORY (Redis disk scan) — kept for Host cutover
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

// Server slots platform — register before /servers/:serverId/live
router.get('/servers', (req, res) => {
  void listServerSlotsHandler(req, res);
});
router.post('/servers', (req, res) => {
  void upsertServerSlotHandler(req, res);
});
router.post('/servers/allocate', (req, res) => {
  void allocateServerSlotHandler(req, res);
});
router.get('/servers/:serverId/live', (req, res) => {
  void getServerLiveHandler(req, res);
});
router.post('/servers/:slotId/apply-config', (req, res) => {
  void applyServerSlotConfigHandler(req, res);
});
router.post('/servers/:slotId/start', (req, res) => {
  void startServerSlotHandler(req, res);
});
router.post('/servers/:slotId/stop', (req, res) => {
  void stopServerSlotHandler(req, res);
});
router.post('/servers/:slotId/restart', (req, res) => {
  void restartServerSlotHandler(req, res);
});
router.get('/servers/:slotId', (req, res) => {
  void getServerSlotHandler(req, res);
});

export default router;
