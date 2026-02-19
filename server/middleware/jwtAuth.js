/**
 * JWT authentication middleware for protected routes.
 * Expects Authorization: Bearer <jwt>. Verifies signature and expiry; attaches req.auth (sub = public_key).
 */

import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/sep10.js';

export function jwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    if (!JWT_SECRET) {
      return res.status(503).json({ error: 'Auth not configured' });
    }
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (!decoded.sub) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    req.auth = { publicKey: decoded.sub };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
}
