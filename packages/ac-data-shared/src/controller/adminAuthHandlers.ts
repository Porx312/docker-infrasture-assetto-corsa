import type { Request, Response } from 'express';
import {
  generateToken,
  getAdminCredentials,
  verifyToken,
  ADMIN_TOKEN_COOKIE_OPTIONS,
} from '../middleware/adminAuth.js';

export async function adminLogin(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Bad request', message: 'Username and password required' });
    return;
  }

  const creds = getAdminCredentials();
  if (!creds) {
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Admin credentials not configured',
    });
    return;
  }

  if (username !== creds.username || password !== creds.password) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    return;
  }

  const token = generateToken(username);
  res.cookie('admin_token', token, ADMIN_TOKEN_COOKIE_OPTIONS);
  res.json({ ok: true, message: 'Login successful', token });
}

export async function adminLogout(_req: Request, res: Response): Promise<void> {
  res.clearCookie('admin_token', {
    httpOnly: ADMIN_TOKEN_COOKIE_OPTIONS.httpOnly,
    secure: ADMIN_TOKEN_COOKIE_OPTIONS.secure,
    sameSite: ADMIN_TOKEN_COOKIE_OPTIONS.sameSite,
    path: ADMIN_TOKEN_COOKIE_OPTIONS.path,
  });
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
