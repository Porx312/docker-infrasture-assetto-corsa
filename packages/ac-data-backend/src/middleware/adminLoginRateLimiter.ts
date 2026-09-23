import rateLimit from 'express-rate-limit';
import { ipKeyGenerator } from 'express-rate-limit';

const ADMIN_LOGIN_RATE_LIMIT_MAX = Number(process.env.ADMIN_LOGIN_RATE_LIMIT_MAX || 10);

export const adminLoginRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: ADMIN_LOGIN_RATE_LIMIT_MAX,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts; try again later' },
});
