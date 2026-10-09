import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { hubOrAdminAuth } from '../middleware/hubOrAdminAuth.js';
import {
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
    getServerRuntimeHandler,
    startServerAdminHandler,
    stopServerAdminHandler,
    restartServerAdminHandler,
    provisionServerAdminHandler,
    getHudReleasesHandler,
    uploadHudReleaseHandler,
    deleteHudReleaseHandler,
    downloadHudReleaseAdminHandler,
    deleteEmptyContentAdminHandler,
} from '../controller/adminController.js';
import { getAdminHealthHandler } from '@projectd/ac-data-shared/controller/healthController.js';

const router = Router();

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

router.get('/health', hubOrAdminAuth, getAdminHealthHandler);

router.get('/content', hubOrAdminAuth, getContent);
router.get('/content/:type', hubOrAdminAuth, getContentItems);
router.get('/preview/:type/:name/:variant', hubOrAdminAuth, getContentPreview);
router.delete('/content/:type/:name', hubOrAdminAuth, deleteContentItem);

router.post('/upload/:type', hubOrAdminAuth, handleMulterUpload(upload.single('file')), uploadContent);
router.post(
    '/upload-multiple/:type',
    hubOrAdminAuth,
    handleMulterUpload(upload.array('files', 20)),
    uploadMultipleContent,
);

router.delete('/content/empty', hubOrAdminAuth, deleteEmptyContentAdminHandler);

router.get('/hud/releases', hubOrAdminAuth, getHudReleasesHandler);
router.post('/hud/releases', hubOrAdminAuth, handleMulterUpload(upload.single('file')), uploadHudReleaseHandler);
router.delete('/hud/releases/:filename', hubOrAdminAuth, deleteHudReleaseHandler);
router.get('/hud/releases/:filename/download', hubOrAdminAuth, downloadHudReleaseAdminHandler);

router.get('/branding', hubOrAdminAuth, getServerBrandingHandler);
router.put('/branding', hubOrAdminAuth, updateServerBrandingHandler);
router.post('/servers/provision', hubOrAdminAuth, provisionServerAdminHandler);
router.get('/servers/:name/config', hubOrAdminAuth, getServerInstanceConfigHandler);
router.put('/servers/:name/config', hubOrAdminAuth, updateServerInstanceConfigHandler);
router.get('/servers/:name/runtime', hubOrAdminAuth, getServerRuntimeHandler);
router.post('/servers/:name/start', hubOrAdminAuth, startServerAdminHandler);
router.post('/servers/:name/stop', hubOrAdminAuth, stopServerAdminHandler);
router.post('/servers/:name/restart', hubOrAdminAuth, restartServerAdminHandler);

export default router;
