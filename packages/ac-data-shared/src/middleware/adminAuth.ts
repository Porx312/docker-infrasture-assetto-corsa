import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { isProductionLike } from '../config/env.js';

function jwtSecret(): string {
    return (process.env.ADMIN_JWT_SECRET || '').trim();
}

/** SameSite=None requires Secure; for HTTP admin panel use Lax (same origin). */
function cookieSecure(): boolean {
    const raw = (process.env.ADMIN_COOKIE_SECURE || '').trim().toLowerCase();
    if (raw === 'true' || raw === '1') return true;
    if (raw === 'false' || raw === '0') return false;
    // Prod default: Secure cookies (HTTPS). Dev HTTP admin: unset → false.
    return isProductionLike();
}

function cookieSameSite(): 'none' | 'lax' {
    return cookieSecure() &&
        (process.env.ADMIN_COOKIE_SAMESITE || '').trim().toLowerCase() === 'none'
        ? 'none'
        : 'lax';
}

export function getAdminTokenCookieOptions(): {
    httpOnly: true;
    secure: boolean;
    sameSite: 'none' | 'lax';
    path: string;
    maxAge: number;
} {
    return {
        httpOnly: true,
        secure: cookieSecure(),
        sameSite: cookieSameSite(),
        path: '/',
        maxAge: 24 * 60 * 60 * 1000,
    };
}

export interface AuthPayload {
    username: string;
    iat: number;
}

export function generateToken(username: string): string {
    const secret = jwtSecret();
    if (!secret) {
        throw new Error('ADMIN_JWT_SECRET is not configured');
    }
    return jwt.sign({ username }, secret, { expiresIn: '24h' });
}

export function verifyToken(token: string): AuthPayload | null {
    const secret = jwtSecret();
    if (!secret) {
        return null;
    }
    try {
        return jwt.verify(token, secret) as AuthPayload;
    } catch {
        return null;
    }
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
    const token = req.cookies?.admin_token || req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
        res.status(401).json({ error: 'Unauthorized', message: 'No token provided' });
        return;
    }

    const payload = verifyToken(token);
    if (!payload) {
        res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token' });
        return;
    }

    (req as any).adminUser = payload.username;
    next();
}

export function getAdminCredentials(): { username: string; password: string } | null {
    const username = (process.env.ADMIN_USER || '').trim();
    const password = (process.env.ADMIN_PASS || '').trim();
    if (!username || !password) {
        return null;
    }
    return { username, password };
}