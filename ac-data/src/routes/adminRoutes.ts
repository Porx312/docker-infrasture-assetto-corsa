import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { adminAuth } from '../middleware/adminAuth.js';
import {
    adminLogin,
    adminLogout,
    adminCheck,
    getContent,
    getContentItems,
    getContentPreview,
    deleteContentItem,
    uploadContent,
    uploadMultipleContent,
    getServerBrandingHandler,
    updateServerBrandingHandler,
    getServerInstanceConfigHandler,
    updateServerInstanceConfigHandler,
    getHudReleasesHandler,
    uploadHudReleaseHandler,
    deleteHudReleaseHandler,
    downloadHudReleaseAdminHandler,
    getLauncherReleasesHandler,
    uploadLauncherReleaseHandler,
    deleteLauncherReleaseHandler,
    downloadLauncherReleaseAdminHandler,
    deleteEmptyContentAdminHandler,
} from '../controller/adminController.js';
import {
    getActivityFeedHandler,
    getActivityServersHandler,
    getActivitySummaryHandler,
    getActivityTimelineHandler,
} from '../controller/activityController.js';
import { getAdminHealthHandler } from '../controller/healthController.js';

import { fileURLToPath } from 'url';

const router = Router();
const acDataRoot = path.dirname(fileURLToPath(import.meta.url));
const VIEWS_PATH = process.env.ADMIN_VIEWS_PATH || path.join(acDataRoot, '..', '..', 'views');

const uploadDir = process.env.ADMIN_UPLOAD_DIR || '/tmp/ac-admin-uploads';
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    },
});

const upload = multer({
    storage,
    limits: {
        fileSize: 500 * 1024 * 1024,
    },
});

router.get('/login', (_req, res) => {
    res.sendFile(path.join(VIEWS_PATH, 'login.html'));
});

router.post('/login', adminLogin);
router.post('/logout', adminLogout);
router.get('/dashboard', adminAuth, (_req, res) => {
    res.sendFile(path.join(VIEWS_PATH, 'dashboard.html'));
});

router.get('/check', adminCheck);

router.get('/health', adminAuth, getAdminHealthHandler);

router.get('/content', adminAuth, getContent);
router.get('/content/:type', adminAuth, getContentItems);
router.get('/preview/:type/:name/:variant', adminAuth, getContentPreview);
router.delete('/content/:type/:name', adminAuth, deleteContentItem);
function handleMulterUpload(
    uploadMiddleware: ReturnType<typeof upload.single> | ReturnType<typeof upload.array>,
) {
    return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
        uploadMiddleware(req, res, (err: unknown) => {
            if (!err) {
                next();
                return;
            }
            const message =
                err instanceof multer.MulterError
                    ? `Upload rejected: ${err.code}${err.field ? ` (${err.field})` : ''}`
                    : err instanceof Error
                      ? err.message
                      : 'Upload failed';
            res.status(400).json({ ok: false, message });
        });
    };
}

router.post('/upload/:type', adminAuth, handleMulterUpload(upload.single('file')), uploadContent);
router.post(
    '/upload-multiple/:type',
    adminAuth,
    handleMulterUpload(upload.array('files', 20)),
    uploadMultipleContent,
);

router.delete('/content/empty', adminAuth, deleteEmptyContentAdminHandler);

router.get('/hud/releases', adminAuth, getHudReleasesHandler);
router.post('/hud/releases', adminAuth, handleMulterUpload(upload.single('file')), uploadHudReleaseHandler);
router.delete('/hud/releases/:filename', adminAuth, deleteHudReleaseHandler);
router.get('/hud/releases/:filename/download', adminAuth, downloadHudReleaseAdminHandler);

router.get('/launcher/releases', adminAuth, getLauncherReleasesHandler);
router.post('/launcher/releases', adminAuth, handleMulterUpload(upload.single('file')), uploadLauncherReleaseHandler);
router.delete('/launcher/releases/:filename', adminAuth, deleteLauncherReleaseHandler);
router.get('/launcher/releases/:filename/download', adminAuth, downloadLauncherReleaseAdminHandler);

router.get('/branding', adminAuth, getServerBrandingHandler);
router.put('/branding', adminAuth, updateServerBrandingHandler);
router.get('/servers/:name/config', adminAuth, getServerInstanceConfigHandler);
router.put('/servers/:name/config', adminAuth, updateServerInstanceConfigHandler);

router.get('/activity/servers', adminAuth, getActivityServersHandler);
router.get('/activity/feed', adminAuth, getActivityFeedHandler);
router.get('/activity/summary', adminAuth, getActivitySummaryHandler);
router.get('/activity/timeline', adminAuth, getActivityTimelineHandler);

export default router;