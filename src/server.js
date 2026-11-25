// Entry point: migrate, seed demo data when enabled and empty, start HTTP server.
const config = require('./config');
const db = require('./db');
const { seed } = require('./db/seed');
const { createApp } = require('./app');

(async () => {
  if (config.nodeEnv === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET مطلوب في الإنتاج');
  if (config.nodeEnv === 'production' && config.demoMode) console.warn('تحذير: DEMO_MODE=true في الإنتاج — عطّله قبل الإطلاق');
  await db.migrate();
  if (config.demoMode) {
    const n = await db.one('SELECT COUNT(*)::int AS n FROM users');
    if (!n || n.n === 0) await seed();
  }
  createApp().listen(config.port, () => {
    console.log(`وصلة عمل تعمل على http://localhost:${config.port}  (${config.databaseUrl ? 'PostgreSQL' : 'قاعدة ذاكرة تجريبية'}, demo=${config.demoMode})`);
  });
})().catch((e) => { console.error(e); process.exit(1); });
