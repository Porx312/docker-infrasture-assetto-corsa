import { Router } from 'express';
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

const uploadDir = '/tmp/ac-admin-uploads';
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
router.post('/upload/:type', adminAuth, upload.single('file'), uploadContent);
router.post('/upload-multiple/:type', adminAuth, upload.array('files', 20), uploadMultipleContent);

export default router;