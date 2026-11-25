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
    ai: env.AI_PROVIDER || 'heuristic',          // heuristic | openai_compatible (FreeLLMAPI, OpenAI, ...)
    ocr: env.OCR_PROVIDER || 'none',             // none | tesseract
    whatsapp: env.WHATSAPP_PROVIDER || 'mock',   // mock | cloud_api
    sms: env.SMS_PROVIDER || 'mock',
    email: env.EMAIL_PROVIDER || 'mock',         // mock | smtp | gmail_oauth
    telegram: env.TELEGRAM_PROVIDER || 'mock',
  },
  ai: {
    baseUrl: env.AI_BASE_URL || 'http://localhost:3001/v1', // FreeLLMAPI default
    apiKey: env.AI_API_KEY || '',
    model: env.AI_MODEL || 'auto',
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
