// [EXT-*] Swappable providers: OTP, private storage, text extraction/OCR, messaging channels.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

// ---------- [EXT-STORAGE] private storage + signed temporary URLs ----------
const storage = {
  async put(buffer, ext) {
    const key = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${ext}`;
    const full = path.join(config.storageDir, key);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, buffer);
    return key;
  },
  async get(key) {
    const full = path.resolve(config.storageDir, key);
    if (!full.startsWith(path.resolve(config.storageDir))) throw new Error('bad key');
    return fs.promises.readFile(full);
  },
  sign(docId, userId) {
    const exp = Math.floor(Date.now() / 1000) + config.signedUrlTtlSec;
    const sig = crypto.createHmac('sha256', config.sessionSecret).update(`${docId}.${userId}.${exp}`).digest('hex');
    return `/api/files/${docId}?u=${userId}&exp=${exp}&sig=${sig}`;
  },
  verify(docId, userId, exp, sig) {
    if (!exp || Number(exp) < Date.now() / 1000) return false;
    const want = crypto.createHmac('sha256', config.sessionSecret).update(`${docId}.${userId}.${exp}`).digest('hex');
    return typeof sig === 'string' && sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  },
};

// ---------- file type checks by magic bytes (never trust the client mime) ----------
function sniff(buf) {
  if (buf.length >= 4 && buf.slice(0, 4).toString() === '%PDF') return { mime: 'application/pdf', ext: '.pdf' };
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from('word/'))) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx' };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  return null;
}

// ---------- text extraction + OCR ----------
async function extractText(buffer, mime) {
  if (mime === 'application/pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const r = await parser.getText();
      return (r.text || '').replace(/--\s*\d+\s+of\s+\d+\s*--/g, '');
    } finally { await parser.destroy().catch(() => {}); }
  }
  if (mime.includes('wordprocessingml')) {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ buffer });
    return r.value || '';
  }
  return '';
}

async function ocr(buffer) {
  if (config.providers.ocr === 'tesseract') {
    // Optional: npm i tesseract.js ; reads images (scanned PDFs need page rasterizing first).
    const { createWorker } = require('tesseract.js');
    const worker = await createWorker(['ara', 'eng']);
    const { data } = await worker.recognize(buffer);
    await worker.terminate();
    return data.text || '';
  }
  throw new Error('OCR غير مفعّل (OCR_PROVIDER=none) — الملف يبدو صورة ممسوحة');
}

// ---------- [EXT-OTP] ----------
const otp = {
  async send(destination, code) {
    if (config.providers.otp === 'mock') return { simulated: true, devCode: config.nodeEnv === 'production' ? undefined : code };
    throw new Error(`OTP provider ${config.providers.otp} not configured — see README`);
  },
};

// ---------- [EXT-WHATSAPP] [EXT-SMS] [EXT-EMAIL] [EXT-TELEGRAM] ----------
const channels = {
  whatsapp: { label: 'واتساب', manualLink: (phone, text) => `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(text)}` },
  sms: { label: 'SMS' },
  email: { label: 'البريد' },
  telegram: { label: 'تيليجرام' },
};

// recipients: [{ id, phone, ... }], vars(r) -> template variables in order.
// Returns per-recipient results. Real providers report "accepted"; "sent"/"delivered" come only from webhooks.
async function sendBatch(channel, recipients, renderText, templateKey, vars) {
  const provider = config.providers[channel];
  if (provider === 'mock') return { status: 'simulated', results: recipients.map((r) => ({ candidateId: r.id, to: r.phone, status: 'simulated', text: renderText(r) })) };
  if (channel === 'whatsapp' && provider === 'cloud_api') {
    const wa = require('./whatsapp');
    if (!config.whatsapp.templates[templateKey]) throw new Error(`لا يوجد قالب واتساب معتمد مربوط بهذا القالب — اضبط WHATSAPP_TEMPLATE_${String(templateKey).toUpperCase()}`);
    const results = [];
    for (const r of recipients) {
      // sequential on purpose: respects provider throughput limits and keeps ordering simple
      const out = await wa.sendTemplate(r.phone, templateKey, vars(r)).catch((e) => ({ ok: false, error: e.message }));
      results.push({ candidateId: r.id, to: r.phone, status: out.ok ? 'accepted' : 'failed', providerMessageId: out.providerMessageId || null, error: out.error || null });
    }
    const ok = results.filter((x) => x.status === 'accepted').length;
    return { status: ok === results.length ? 'accepted' : ok ? 'partial' : 'failed', results };
  }
  throw new Error(`القناة ${channel} بالمزود "${provider}" غير مفعّلة بعد — راجع README`);
}

module.exports = { storage, sniff, extractText, ocr, otp, channels, sendBatch };
