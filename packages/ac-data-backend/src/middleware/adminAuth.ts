import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || '';

/** SameSite=None requires Secure; for HTTP admin panel use Lax (same origin). */
const cookieSecure =
    (process.env.ADMIN_COOKIE_SECURE || '').trim().toLowerCase() === 'true';
const cookieSameSite =
    cookieSecure &&
    (process.env.ADMIN_COOKIE_SAMESITE || '').trim().toLowerCase() === 'none'
        ? ('none' as const)
        : ('lax' as const);

export const ADMIN_TOKEN_COOKIE_OPTIONS = {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: cookieSameSite,
    path: '/',
    maxAge: 24 * 60 * 60 * 1000,
};

export interface AuthPayload {
    username: string;
    iat: number;
}

export function generateToken(username: string): string {
    if (!JWT_SECRET) {
        throw new Error('ADMIN_JWT_SECRET is not configured');
    }
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: '24h' });
}

export function verifyToken(token: string): AuthPayload | null {
    if (!JWT_SECRET) {
        return null;
    }
    try {
        return jwt.verify(token, JWT_SECRET) as AuthPayload;
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