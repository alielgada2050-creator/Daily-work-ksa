// [EXT-WHATSAPP] WhatsApp Business Platform (Cloud API).
// Business-initiated messages must use templates pre-approved in Meta WhatsApp Manager.
// Map each platform template to an approved template name via WHATSAPP_TEMPLATE_<KEY>.
// Statuses ("sent", "delivered", "read", "failed") arrive later on the webhook.
const crypto = require('crypto');
const config = require('../config');

const KEYS = ['invite', 'availability', 'interview', 'missing_doc', 'start_confirm'];

function templateName(key) {
  return config.whatsapp.templates[key] || null;
}

function toWaId(phone) {
  return String(phone || '').replace(/\D/g, '');
}

// Body variables in order: {{1}} name, {{2}} order title, {{3}} city or date (see README).
function buildPayload(to, key, vars) {
  return {
    messaging_product: 'whatsapp',
    to: toWaId(to),
    type: 'template',
    template: {
      name: templateName(key),
      language: { code: config.whatsapp.language },
      components: [{ type: 'body', parameters: vars.map((v) => ({ type: 'text', text: String(v ?? '').slice(0, 1000) || '-' })) }],
    },
  };
}

async function sendTemplate(to, key, vars) {
  if (!config.whatsapp.token || !config.whatsapp.phoneId) throw new Error('WHATSAPP_TOKEN و WHATSAPP_PHONE_ID مطلوبان');
  if (!templateName(key)) throw new Error(`لا يوجد قالب واتساب معتمد مربوط بـ ${key} (WHATSAPP_TEMPLATE_${key.toUpperCase()})`);
  const res = await fetch(`${config.whatsapp.apiBase.replace(/\/$/, '')}/${config.whatsapp.phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.whatsapp.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildPayload(to, key, vars)),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || {};
    return { ok: false, error: `${err.code || res.status}: ${err.message || 'request failed'}`.slice(0, 300) };
  }
  return { ok: true, providerMessageId: data.messages && data.messages[0] && data.messages[0].id };
}

// Webhook signature: X-Hub-Signature-256 = "sha256=" + HMAC_SHA256(app secret, raw body)
function verifySignature(rawBody, header) {
  if (!config.whatsapp.appSecret) return false;
  const want = `sha256=${crypto.createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex')}`;
  return typeof header === 'string' && header.length === want.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(want));
}

function extractStatuses(body) {
  const out = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const s of (change.value && change.value.statuses) || []) {
        out.push({ id: s.id, status: s.status, error: s.errors && s.errors[0] ? `${s.errors[0].code}: ${s.errors[0].title || s.errors[0].message || ''}` : null });
      }
    }
  }
  return out;
}

module.exports = { KEYS, sendTemplate, buildPayload, verifySignature, extractStatuses, toWaId };
