// =====================================================================
// THE SHARED SECRET: every webhook call must carry X-Webhook-Token equal
// to WEBHOOK_SECRET. Compared in constant time, so the response time says
// nothing about how much of a guess was right.
// =====================================================================

import { createHash, timingSafeEqual } from 'node:crypto';

// Both sides hashed first: timingSafeEqual needs equal lengths
const digest = value => createHash('sha256').update(String(value)).digest();

export function verifyToken(secret) {
  if (!secret) throw new Error('WEBHOOK_SECRET is not set');
  const expected = digest(secret);
  return (req, res, next) => {
    const token = req.get('X-Webhook-Token');
    if (!token || !timingSafeEqual(digest(token), expected)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}
