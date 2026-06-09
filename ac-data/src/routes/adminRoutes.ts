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
    deleteContentItem,
    uploadContent,
    uploadMultipleContent,
} from '../controller/adminController.js';

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

const VIEWS_PATH = '/home/jose/assetto-infra/ac-data/views';

router.get('/login', (_req, res) => {
    res.sendFile(path.join(VIEWS_PATH, 'login.html'));
});

router.post('/login', adminLogin);
router.post('/logout', adminLogout);
router.get('/dashboard', adminAuth, (_req, res) => {
    res.sendFile(path.join(VIEWS_PATH, 'dashboard.html'));
});

router.get('/check', adminCheck);

router.get('/content', adminAuth, getContent);
router.get('/content/:type', adminAuth, getContentItems);
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

export default router;