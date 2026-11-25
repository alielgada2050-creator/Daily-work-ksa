// [MOD-APP] Express app: security headers, rate limits, modules, static PWA.
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const auth = require('./modules/auth');
const orders = require('./modules/orders');
const candidates = require('./modules/candidates');
const admin = require('./modules/admin');
const webhooks = require('./modules/webhooks');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:'], scriptSrc: ["'self'"] } } }));
  app.use('/api/webhooks', express.raw({ type: '*/*', limit: '1mb' }), webhooks.router);
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());
  app.use('/api', rateLimit({ windowMs: 60e3, limit: Number(process.env.API_RATE_LIMIT || 600), standardHeaders: true, legacyHeaders: false }));
  app.use('/api', auth.loadUser);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', auth.router);
  app.use('/api', admin.router);
  app.use('/api', orders.router);
  app.use('/api', candidates.router);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code, message: err.code === 'LIMIT_FILE_SIZE' ? 'الملف أكبر من الحد المسموح' : 'خطأ في الرفع' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.code || 'error', message: status >= 500 ? 'خطأ غير متوقع' : err.message });
  });
  return app;
}

module.exports = { createApp };
