// [MOD-CONFIG] All secrets and provider choices come from environment variables.
const path = require('path');
const crypto = require('crypto');

const env = process.env;

module.exports = {
  port: Number(env.PORT || 3000),
  nodeEnv: env.NODE_ENV || 'development',
  databaseUrl: env.DATABASE_URL || '',            // empty => in-memory pg-mem demo database
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
  cookieSecure: (env.COOKIE_SECURE || (env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true', // needs HTTPS
  demoMode: (env.DEMO_MODE || 'true') === 'true',  // enables demo login + seeded fake data
  storageDir: env.STORAGE_DIR || path.join(__dirname, '..', 'storage'),
  signedUrlTtlSec: Number(env.SIGNED_URL_TTL_SEC || 600),
  maxCvBytes: Number(env.MAX_CV_MB || 10) * 1024 * 1024,
  maxDocBytes: Number(env.MAX_DOC_MB || 5) * 1024 * 1024,
  providers: {
    otp: env.OTP_PROVIDER || 'mock',             // mock | twilio_verify
    storage: env.STORAGE_PROVIDER || 'local',    // local | s3 (to implement)
    ocr: env.OCR_PROVIDER || 'none',             // none | tesseract
    whatsapp: env.WHATSAPP_PROVIDER || 'mock',   // mock | cloud_api
    sms: env.SMS_PROVIDER || 'mock',
    email: env.EMAIL_PROVIDER || 'mock',         // mock | smtp | gmail_oauth
    telegram: env.TELEGRAM_PROVIDER || 'mock',
  },
  ai: {
    // Ordered provider chain; the local extractor is always the final fallback.
    chain: (env.AI_CHAIN || (env.AI_PROVIDER === 'openai_compatible' ? 'openai_compatible' : '')).split(',').map((x) => x.trim()).filter(Boolean),
    timeoutMs: Number(env.AI_TIMEOUT_MS || 30000),
    redactContact: (env.AI_REDACT_CONTACT || 'true') === 'true',
    claude: { baseUrl: env.CLAUDE_BASE_URL || 'https://api.anthropic.com', apiKey: env.CLAUDE_API_KEY || '', model: env.CLAUDE_MODEL || 'claude-haiku-5-5' },
    ninerouter: { baseUrl: env.NINEROUTER_URL ? `${env.NINEROUTER_URL.replace(/\/$/, '')}/v1` : '', apiKey: env.NINEROUTER_KEY || '', model: env.NINEROUTER_MODEL || '' },
    freellmapi: { baseUrl: env.FREELLMAPI_URL || 'http://localhost:3001/v1', apiKey: env.FREELLMAPI_KEY || '', model: env.FREELLMAPI_MODEL || 'auto' },
    fcc: { baseUrl: env.FCC_URL || 'http://127.0.0.1:8082/v1', apiKey: env.FCC_TOKEN || '', model: env.FCC_MODEL || '' },
    generic: { baseUrl: env.AI_BASE_URL || '', apiKey: env.AI_API_KEY || '', model: env.AI_MODEL || 'auto' },
  },
  whatsapp: {
    token: env.WHATSAPP_TOKEN || '',
    phoneId: env.WHATSAPP_PHONE_ID || '',
    apiBase: env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0',
    appSecret: env.WHATSAPP_APP_SECRET || '',     // verifies webhook signatures
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '', // webhook subscription handshake
    language: env.WHATSAPP_TEMPLATE_LANG || 'ar',
    templates: {
      invite: env.WHATSAPP_TEMPLATE_INVITE || '',
      availability: env.WHATSAPP_TEMPLATE_AVAILABILITY || '',
      interview: env.WHATSAPP_TEMPLATE_INTERVIEW || '',
      missing_doc: env.WHATSAPP_TEMPLATE_MISSING_DOC || '',
      start_confirm: env.WHATSAPP_TEMPLATE_START_CONFIRM || '',
    },
  },
  telegram: { botToken: env.TELEGRAM_BOT_TOKEN || '' },
};
