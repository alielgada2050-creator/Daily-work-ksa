// [MOD-MARKETS] [UI-ADMIN] [UI-SUPPORT] platform administration, market settings, support.
const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const config = require('../config');
const { audit, HttpError, isAdmin } = require('../lib/core');
const { requireUser } = require('./auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const adminOnly = (req, _res, next) => (isAdmin(req.user) ? next() : next(new HttpError(403, 'لإدارة المنصة فقط')));

// Public: support info + market list (no secrets).
router.get('/support/info', wrap(async (_req, res) => {
  const row = await db.one("SELECT value FROM settings WHERE key = 'support'");
  res.json(row ? JSON.parse(row.value) : {});
}));
router.get('/markets', wrap(async (_req, res) => {
  const rows = await db.query('SELECT code, name, config FROM markets ORDER BY code');
  res.json({ items: rows.map((r) => ({ code: r.code, name: r.name, config: JSON.parse(r.config) })) });
}));
router.get('/providers', (_req, res) => res.json({ providers: config.providers, demoMode: config.demoMode }));

router.use(['/support/tickets', '/admin'], requireUser);

router.post('/support/tickets', wrap(async (req, res) => {
  const body = String(req.body.body || '').trim();
  if (body.length < 5) throw new HttpError(422, 'اكتب وصفًا للمشكلة');
  const code = `TCK-${crypto.randomInt(1000, 9999)}`;
  const t = await db.one('INSERT INTO support_tickets (code, user_id, order_id, body) VALUES ($1,$2,$3,$4) RETURNING *', [code, req.user.id, req.body.orderId ? Number(req.body.orderId) : null, body.slice(0, 4000)]);
  await audit(req.user, 'ticket_create', 'ticket', t.id, { orderId: t.order_id });
  res.status(201).json(t);
}));

router.use('/admin', adminOnly);

router.get('/admin/orgs', wrap(async (_req, res) => res.json({ items: await db.query('SELECT * FROM orgs ORDER BY id') })));

router.post('/admin/orgs/:id/verify', wrap(async (req, res) => {
  const state = req.body.state === 'rejected' ? 'rejected' : 'manual_verified';
  await db.query('UPDATE orgs SET verification = $1 WHERE id = $2', [state, Number(req.params.id)]);
  await audit(req.user, `org_${state}`, 'org', req.params.id, { note: req.body.note || null });
  res.json({ ok: true, state });
}));

router.get('/admin/audit', wrap(async (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json({ items: await db.query('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT $1', [limit]) });
}));

router.get('/admin/duplicates', wrap(async (_req, res) => {
  const rows = await db.query('SELECT id, code, full_name, phone, email FROM candidates WHERE phone IS NOT NULL ORDER BY phone');
  const groups = {};
  for (const r of rows) (groups[r.phone] = groups[r.phone] || []).push(r);
  const jobs = await db.query("SELECT j.id, j.filename, j.duplicate_of, c.code FROM cv_jobs j JOIN candidates c ON c.id = j.duplicate_of WHERE j.status = 'duplicate'");
  res.json({ samePhone: Object.values(groups).filter((g) => g.length > 1), importHeld: jobs });
}));

router.get('/admin/tickets', wrap(async (_req, res) => res.json({ items: await db.query('SELECT * FROM support_tickets ORDER BY id DESC') })));

router.put('/admin/markets/:code', wrap(async (req, res) => {
  const m = await db.one('SELECT * FROM markets WHERE code = $1', [req.params.code]);
  const cfg = { ...(m ? JSON.parse(m.config) : {}), ...(req.body.config || {}) };
  if (m) await db.query('UPDATE markets SET name = $1, config = $2 WHERE code = $3', [req.body.name || m.name, JSON.stringify(cfg), m.code]);
  else await db.query('INSERT INTO markets (code, name, config) VALUES ($1,$2,$3)', [req.params.code, req.body.name || req.params.code, JSON.stringify(cfg)]);
  await audit(req.user, 'market_update', 'market', req.params.code, { keys: Object.keys(req.body.config || {}) });
  res.json({ ok: true, config: cfg });
}));

router.put('/admin/support', wrap(async (req, res) => {
  const allowed = ['phone', 'whatsapp', 'email', 'hours', 'note'];
  const v = {}; for (const k of allowed) if (req.body[k] != null) v[k] = String(req.body[k]).slice(0, 200);
  const cur = await db.one("SELECT value FROM settings WHERE key = 'support'");
  const merged = { ...(cur ? JSON.parse(cur.value) : {}), ...v };
  if (cur) await db.query("UPDATE settings SET value = $1 WHERE key = 'support'", [JSON.stringify(merged)]);
  else await db.query("INSERT INTO settings (key, value) VALUES ('support', $1)", [JSON.stringify(merged)]);
  await audit(req.user, 'support_info_update', 'settings', 'support', {});
  res.json(merged);
}));

module.exports = { router };
