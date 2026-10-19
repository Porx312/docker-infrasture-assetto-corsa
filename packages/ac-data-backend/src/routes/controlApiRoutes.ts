import { Router, raw } from 'express';
import multer from 'multer';
import os from 'node:os';
import path from 'node:path';
import {
  controlLibrarySlimUploadCommitHandler,
  controlLibrarySlimUploadFileHandler,
  controlLibrarySlimUploadPlanHandler,
  controlLibraryZipUploadHandler,
  ensureInstanceModsHandler,
  getAgentPresenceHandler,
  getCentralModBySlugHandler,
  getInstanceModsCarsHandler,
  getInstanceModsTracksHandler,
  getLiveSummaryHandler,
  getModsAvailabilityHandler,
  getServerLiveHandler,
  listCentralModsHandler,
  listModsBySteamHandler,
  postAgentHeartbeatHandler,
  postAgentModsHandler,
  postAgentRegisterHandler,
  postDesiredConfigHandler,
  postHostCatalogSyncServersHandler,
  unlinkSteamLibraryModHandler,
} from '../controller/controlApiController.js';

const router = Router();

const zipUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, process.env.ADMIN_UPLOAD_DIR || os.tmpdir());
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.zip';
      cb(null, `library-zip-${Date.now()}${ext}`);
    },
  }),
  limits: {
    fileSize: Number(process.env.CONTROL_MOD_UPLOAD_MAX_BYTES || 500 * 1024 * 1024),
  },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const ok =
      name.endsWith('.zip') ||
      file.mimetype === 'application/zip' ||
      file.mimetype === 'application/x-zip-compressed' ||
      file.mimetype === 'application/octet-stream';
    cb(null, ok);
  },
});

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

// User library (steamId links) — register before /mods/:slug
router.post(
  '/mods/library/zip-upload',
  (req, res, next) => {
    zipUpload.single('file')(req, res, (err: unknown) => {
      if (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ ok: false, message: `upload_failed: ${message}` });
        return;
      }
      next();
    });
  },
  (req, res) => {
    void controlLibraryZipUploadHandler(req, res);
  },
);
router.post('/mods/library/slim-upload/plan', (req, res) => {
  void controlLibrarySlimUploadPlanHandler(req, res);
});
router.put(
  '/mods/library/slim-upload/file',
  raw({
    type: '*/*',
    limit: Number(process.env.MOD_SLIM_UPLOAD_MAX_FILE_BYTES || 64 * 1024 * 1024),
  }),
  (req, res) => {
    void controlLibrarySlimUploadFileHandler(req, res);
  },
);
router.post('/mods/library/slim-upload/commit', (req, res) => {
  void controlLibrarySlimUploadCommitHandler(req, res);
});
router.get('/mods/library/by-steam/:steamId', (req, res) => {
  void listModsBySteamHandler(req, res);
});
router.delete('/mods/library/:packageId', (req, res) => {
  void unlinkSteamLibraryModHandler(req, res);
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
