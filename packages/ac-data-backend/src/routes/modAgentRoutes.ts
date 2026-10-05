import { Router } from 'express';
import { modInternalDownloadHandler } from '../controller/modController.js';
import {
  modAgentHeartbeatHandler,
  modAgentDesiredStateHandler,
  modAgentAcquireJobHandler,
  modAgentDownloadUrlHandler,
  modAgentJobProgressHandler,
  modAgentJobCompleteHandler,
  modAgentJobFailHandler,
  modAgentInventoryReportHandler,
  modAgentServerModsRefreshHandler,
  modAgentRegisterLocalHandler,
} from '../controller/modAgentController.js';

const router = Router();

router.get('/mods/internal/artifacts/download', modInternalDownloadHandler);

router.post('/mod-agent/v1/heartbeat', modAgentHeartbeatHandler);
router.get('/mod-agent/v1/desired-state', modAgentDesiredStateHandler);
router.post('/mod-agent/v1/jobs/acquire', modAgentAcquireJobHandler);
router.get('/mod-agent/v1/artifacts/:artifactId/download-url', modAgentDownloadUrlHandler);
router.post('/mod-agent/v1/jobs/:jobId/progress', modAgentJobProgressHandler);
router.post('/mod-agent/v1/jobs/:jobId/complete', modAgentJobCompleteHandler);
router.post('/mod-agent/v1/jobs/:jobId/fail', modAgentJobFailHandler);
router.post('/mod-agent/v1/inventory/report', modAgentInventoryReportHandler);
router.post('/mod-agent/v1/artifacts/register-local', modAgentRegisterLocalHandler);
router.post('/mod-agent/v1/servers/:name/mods/refresh', modAgentServerModsRefreshHandler);

export default router;
