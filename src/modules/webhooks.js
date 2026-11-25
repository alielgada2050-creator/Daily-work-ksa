// [MOD-MESSAGING] Provider webhooks. Mounted with a raw body parser so signatures can be verified.
const express = require('express');
const db = require('../db');
const config = require('../config');
const wa = require('../providers/whatsapp');

const router = express.Router();
const RANK = { simulated: 0, accepted: 1, sent: 2, delivered: 3, read: 4 };

// Meta subscription handshake.
router.get('/whatsapp', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && config.whatsapp.verifyToken && req.query['hub.verify_token'] === config.whatsapp.verifyToken) {
    return res.status(200).send(String(req.query['hub.challenge'] || ''));
  }
  res.sendStatus(403);
});

router.post('/whatsapp', async (req, res, next) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!wa.verifySignature(raw, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return res.sendStatus(400); }
    for (const s of wa.extractStatuses(body)) {
      const d = await db.one('SELECT id, status FROM message_deliveries WHERE provider_message_id = $1', [s.id]);
      if (!d) continue;
      // Never downgrade (webhooks can arrive out of order); "failed" always wins.
      if (s.status === 'failed' || (RANK[s.status] ?? -1) > (RANK[d.status] ?? -1)) {
        await db.query('UPDATE message_deliveries SET status = $1, error = $2, updated_at = $3 WHERE id = $4', [s.status, s.error, new Date(), d.id]);
      }
    }
    res.sendStatus(200);
  } catch (e) { next(e); }
});

module.exports = { router };
