// [MOD-AUTH] sessions, demo login, OTP (mobile or email) via swappable provider.
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const config = require('../config');
const { otp } = require('../providers');
const { audit, HttpError } = require('../lib/core');
const { normalizePhone } = require('../lib/phone');

const SESSION_HOURS = 12;
const hash = (s) => crypto.createHmac('sha256', config.sessionSecret).update(s).digest('hex');

async function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)', [hash(token), userId, new Date(Date.now() + SESSION_HOURS * 3600e3)]);
  res.cookie('sid', token, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: SESSION_HOURS * 3600e3 });
}

async function loadUser(req, _res, next) {
  try {
    const token = req.cookies && req.cookies.sid;
    if (token) {
      const s = await db.one('SELECT user_id, expires_at FROM sessions WHERE token = $1', [hash(token)]);
      if (s && new Date(s.expires_at) > new Date()) {
        const user = await db.one('SELECT id, name, phone, email, kind FROM users WHERE id = $1', [s.user_id]);
        if (user) {
          user.memberships = await db.query('SELECT m.org_id, m.role, o.name AS org_name, o.type AS org_type FROM memberships m JOIN orgs o ON o.id = m.org_id WHERE m.user_id = $1', [user.id]);
          req.user = user;
        }
      }
    }
    next();
  } catch (e) { next(e); }
}

function requireUser(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'سجّل الدخول أولًا', 'unauthenticated'));
  next();
}

const router = express.Router();
const otpLimiter = rateLimit({ windowMs: 10 * 60e3, limit: 5, standardHeaders: true, legacyHeaders: false });

router.get('/me', (req, res) => res.json({ user: req.user || null, demoMode: config.demoMode }));

router.get('/demo-users', async (_req, res, next) => {
  try {
    if (!config.demoMode) return res.json({ users: [] });
    const users = await db.query(`SELECT u.id, u.name, u.kind, m.role, o.name AS org_name FROM users u
      LEFT JOIN memberships m ON m.user_id = u.id LEFT JOIN orgs o ON o.id = m.org_id ORDER BY u.id`);
    res.json({ users });
  } catch (e) { next(e); }
});

router.post('/demo-login', async (req, res, next) => {
  try {
    if (!config.demoMode) throw new HttpError(404, 'غير متاح', 'not_found');
    const user = await db.one('SELECT id FROM users WHERE id = $1', [Number(req.body.userId)]);
    if (!user) throw new HttpError(404, 'مستخدم غير موجود');
    await createSession(res, user.id);
    await audit({ id: user.id }, 'login_demo', 'user', user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/otp/request', otpLimiter, async (req, res, next) => {
  try {
    const raw = String(req.body.destination || '').trim();
    const isEmail = raw.includes('@');
    const destination = isEmail ? raw.toLowerCase() : normalizePhone(raw, 'SA').value;
    if (!destination || destination.length < 6) throw new HttpError(422, 'أدخل جوالًا أو بريدًا صحيحًا');
    const code = String(crypto.randomInt(100000, 999999));
    await db.query('INSERT INTO otp_codes (destination, code_hash, expires_at) VALUES ($1,$2,$3)', [destination, hash(code), new Date(Date.now() + 5 * 60e3)]);
    const r = await otp.send(destination, code);
    res.json({ ok: true, simulated: !!r.simulated, devCode: r.devCode });
  } catch (e) { next(e); }
});

router.post('/otp/verify', otpLimiter, async (req, res, next) => {
  try {
    const raw = String(req.body.destination || '').trim();
    const isEmail = raw.includes('@');
    const destination = isEmail ? raw.toLowerCase() : normalizePhone(raw, 'SA').value;
    const row = await db.one('SELECT * FROM otp_codes WHERE destination = $1 ORDER BY id DESC LIMIT 1', [destination]);
    if (!row || new Date(row.expires_at) < new Date() || row.attempts >= 5) throw new HttpError(422, 'الرمز منتهي أو غير صالح');
    if (row.code_hash !== hash(String(req.body.code || ''))) {
      await db.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      throw new HttpError(422, 'الرمز غير صحيح');
    }
    await db.query('DELETE FROM otp_codes WHERE destination = $1', [destination]);
    let user = await db.one(`SELECT id FROM users WHERE ${isEmail ? 'email' : 'phone'} = $1`, [destination]);
    if (!user) {
      user = await db.one(`INSERT INTO users (name, ${isEmail ? 'email' : 'phone'}, kind) VALUES ($1,$2,'seeker') RETURNING id`, ['باحث جديد', destination]);
    }
    await createSession(res, user.id);
    await audit(user, 'login_otp', 'user', user.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/logout', async (req, res) => {
  if (req.cookies && req.cookies.sid) await db.query('DELETE FROM sessions WHERE token = $1', [hash(req.cookies.sid)]);
  res.clearCookie('sid');
  res.json({ ok: true });
});

module.exports = { router, loadUser, requireUser };
