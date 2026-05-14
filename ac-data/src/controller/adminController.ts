import type { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { generateToken, getAdminCredentials, verifyToken } from '../middleware/adminAuth.js';
import { listContent, deleteContent, uploadSingleFile, extractZip, getContentSummary, type ContentType } from '../services/contentManager.js';

const JWT_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: false,
    sameSite: 'none',
    maxAge: 24 * 60 * 60 * 1000,
};

export async function adminLogin(req: Request, res: Response): Promise<void> {
    const { username, password } = req.body;

    if (!username || !password) {
        res.status(400).json({ error: 'Bad request', message: 'Username and password required' });
        return;
    }

    const creds = getAdminCredentials();

    if (username !== creds.username || password !== creds.password) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
        return;
    }

    const token = generateToken(username);
    res.cookie('admin_token', token, JWT_COOKIE_OPTIONS);
    res.json({ ok: true, message: 'Login successful', token });
}

export async function adminLogout(req: Request, res: Response): Promise<void> {
    res.clearCookie('admin_token', { httpOnly: true, secure: false, sameSite: 'none' });
    res.json({ ok: true, message: 'Logged out' });
}

export async function adminCheck(req: Request, res: Response): Promise<void> {
    const token = req.cookies?.admin_token;

    if (!token) {
        res.status(401).json({ authenticated: false });
        return;
    }

    const payload = verifyToken(token);
    if (!payload) {
        res.status(401).json({ authenticated: false });
        return;
    }

    res.json({ authenticated: true, username: payload.username });
}

export async function getContent(req: Request, res: Response): Promise<void> {
    try {
        const summary = await getContentSummary();
        res.json({ ok: true, ...summary });
    } catch (err: any) {
        res.status(500).json({ error: 'Server error', message: err.message });
    }
}

export async function getContentItems(req: Request, res: Response): Promise<void> {
    const type = req.params.type as ContentType;

    if (!['cars', 'tracks', 'weather'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    try {
        const items = await listContent(type);
        res.json({ ok: true, type, items });
    } catch (err: any) {
        res.status(500).json({ error: 'Server error', message: err.message });
    }
}

export async function deleteContentItem(req: Request, res: Response): Promise<void> {
    const type = req.params.type as ContentType;
    const name = String(req.params.name || '');

    if (!['cars', 'tracks', 'weather'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    if (!name || name.includes('..') || name.includes('/')) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid item name' });
        return;
    }

    try {
        const result = await deleteContent(type, name);
        if (result.ok) {
            res.json(result);
        } else {
            res.status(404).json(result);
        }
    } catch (err: any) {
        res.status(500).json({ error: 'Server error', message: err.message });
    }
}

export async function uploadContent(req: Request, res: Response): Promise<void> {
    const type = req.params.type as ContentType;

    if (!['cars', 'tracks', 'weather'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    if (!req.file) {
        res.status(400).json({ error: 'Bad request', message: 'No file uploaded' });
        return;
    }

    try {
        const file = req.file;
        let result;

        console.log(`[upload] File: ${file.originalname}, size: ${file.size}, mimetype: ${file.mimetype}`);

        if (file.originalname.endsWith('.zip')) {
            result = await extractZip(type, file.path);
            console.log(`[upload] ZIP result:`, result);
        } else {
            result = await uploadSingleFile(type, file);
        }

        res.json(result);
    } catch (err: any) {
        console.error(`[upload] Error:`, err);
        res.status(500).json({ error: 'Server error', message: err.message });
    }
}

export async function uploadMultipleContent(req: Request, res: Response): Promise<void> {
    const type = req.params.type as ContentType;

    if (!['cars', 'tracks', 'weather'].includes(type)) {
        res.status(400).json({ error: 'Bad request', message: 'Invalid content type' });
        return;
    }

    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        res.status(400).json({ error: 'Bad request', message: 'No files uploaded' });
        return;
    }

    const results: { file: string; ok: boolean; message: string }[] = [];

    for (const file of req.files) {
        let result;
        if (file.originalname.endsWith('.zip')) {
            result = await extractZip(type, file.path);
        } else {
            result = await uploadSingleFile(type, file);
        }
        results.push({ file: file.originalname, ...result });
    }

    res.json({ ok: true, results });
}