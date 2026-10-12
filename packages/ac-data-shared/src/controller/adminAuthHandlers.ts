import type { Request, Response } from 'express';
import {
  generateToken,
  getAdminCredentials,
  verifyToken,
  getAdminTokenCookieOptions,
} from '../middleware/adminAuth.js';
import { secretsMatch } from '../services/secrets/fleetSecrets.js';

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

  if (!secretsMatch(String(username), creds.username) || !secretsMatch(String(password), creds.password)) {
    res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    return;
  }

  const token = generateToken(username);
  res.cookie('admin_token', token, getAdminTokenCookieOptions());
  // Cookie-only session — do not return JWT in JSON (XSS / extension leakage).
  res.json({ ok: true, message: 'Login successful' });
}

export async function adminLogout(_req: Request, res: Response): Promise<void> {
  const opts = getAdminTokenCookieOptions();
  res.clearCookie('admin_token', {
    httpOnly: opts.httpOnly,
    secure: opts.secure,
    sameSite: opts.sameSite,
    path: opts.path,
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
