// [MOD-DOCS] [MOD-CV-PARSE] candidate profiles, CV batches, field review, documents, consents.
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const config = require('../config');
const { storage, sniff, extractText, ocr } = require('../providers');
const { extractFields } = require('../providers/ai');
const { audit, HttpError, assertOrder, rolesIn, isAdmin } = require('../lib/core');
const { requireUser } = require('./auth');
const { nominate } = require('./orders');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const cvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxCvBytes, files: 200 } });
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxDocBytes, files: 1 } });

const CV_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
const DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const FIELD_TO_COLUMN = { full_name: 'full_name', phone: 'phone', email: 'email', profession: 'profession', skills: 'skills', certs: 'certs', city: 'city', specialty: 'specialty' };

// ---------------- background CV processing ----------------
const queue = [];
let running = false;
function enqueue(jobId) { queue.push(jobId); if (!running) setImmediate(drain); }
async function drain() {
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try { await processJob(id); } catch (e) { await db.query("UPDATE cv_jobs SET status = 'failed', error = $1 WHERE id = $2", [String(e.message).slice(0, 300), id]); }
  }
  running = false;
}
const idle = () => new Promise((r) => { const t = () => (running || queue.length ? setTimeout(t, 20) : r()); t(); });

async function saveFields(candidateId, fields) {
  await db.query('DELETE FROM cv_fields WHERE candidate_id = $1', [candidateId]);
  for (const [field, f] of Object.entries(fields)) {
    await db.query('INSERT INTO cv_fields (candidate_id, field, value, source_ref, confidence, review_state) VALUES ($1,$2,$3,$4,$5,$6)',
      [candidateId, field, f.value == null ? null : String(f.value), f.source_ref || null, f.confidence || 0, f.value == null ? 'missing' : 'pending']);
  }
}

async function processJob(id) {
  const job = await db.one('SELECT * FROM cv_jobs WHERE id = $1', [id]);
  if (!job || job.status === 'done') return;
  await db.query("UPDATE cv_jobs SET status = 'processing', attempts = attempts + 1, error = NULL WHERE id = $1", [id]);
  const buf = await storage.get(job.storage_key);
  let text = await extractText(buf, job.mime).catch(() => '');
  if (text.replace(/\s/g, '').length < 20) text = await ocr(buf); // scanned page; throws if OCR disabled
  const { fields } = await extractFields(text);
  const phone = fields.phone && fields.phone.value;
  const email = fields.email && fields.email.value;
  // Duplicate detection on import: same phone or email already on file -> hold for review, never auto-merge.
  const dup = (phone || email) ? await db.one('SELECT id FROM candidates WHERE (phone = $1 AND $1 IS NOT NULL) OR (email = $2 AND $2 IS NOT NULL) LIMIT 1', [phone || null, email || null]) : null;
  if (dup) { await db.query("UPDATE cv_jobs SET status = 'duplicate', duplicate_of = $1 WHERE id = $2", [dup.id, id]); return; }
  const years = fields.experience_years && fields.experience_years.value ? parseInt(fields.experience_years.value, 10) : null;
  const complete = ['full_name', 'phone', 'profession', 'experience_years', 'certs'].every((k) => fields[k] && fields[k].value);
  const code = `W-${crypto.randomInt(20000, 99999)}`;
  const c = await db.one(`INSERT INTO candidates (code, supplier_org_id, full_name, phone, email, profession, specialty, skills, certs, years_exp, city, cv_complete, available)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true) RETURNING *`,
  [code, job.supplier_org_id, fields.full_name?.value || null, phone || null, email || null, fields.profession?.value || null, fields.specialty?.value || null, fields.skills?.value || null, fields.certs?.value || null, Number.isFinite(years) ? years : null, fields.city?.value || null, complete]);
  await saveFields(c.id, fields);
  await db.query('INSERT INTO documents (candidate_id, kind, filename, mime, size, storage_key) VALUES ($1,$2,$3,$4,$5,$6)', [c.id, 'cv', job.filename, job.mime, buf.length, job.storage_key]);
  if (job.order_id) {
    const order = await db.one('SELECT * FROM orders WHERE id = $1', [job.order_id]);
    await nominate({ id: null }, order, c, job.supplier_org_id).catch(() => {});
  }
  await db.query("UPDATE cv_jobs SET status = 'done', candidate_id = $1 WHERE id = $2", [c.id, id]);
}

router.use(requireUser);

// Supplier uploads a batch of CVs for an assigned order.
router.post('/orders/:id/cv-batch', cvUpload.array('files', 200), wrap(async (req, res) => {
  const order = await db.one('SELECT * FROM orders WHERE id = $1', [Number(req.params.id)]);
  const sc = assertOrder(req.user, order, 'nominate');
  if (!sc.isSupplier) throw new HttpError(403, 'رفع الدفعات متاح للمورد المسند');
  if (!req.files || !req.files.length) throw new HttpError(422, 'أرفق ملفًا واحدًا على الأقل');
  const batchId = crypto.randomUUID();
  const out = [];
  for (const f of req.files) {
    const t = sniff(f.buffer);
    if (!t || !CV_TYPES.includes(t.mime)) { out.push({ filename: f.originalname, status: 'rejected', error: 'النوع غير مقبول (PDF أو DOCX فقط)' }); continue; }
    const key = await storage.put(f.buffer, t.ext);
    const j = await db.one('INSERT INTO cv_jobs (batch_id, order_id, supplier_org_id, filename, storage_key, mime) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [batchId, order.id, order.assigned_supplier_org_id, f.originalname.slice(0, 200), key, t.mime]);
    out.push({ jobId: j.id, filename: f.originalname, status: 'queued' });
    enqueue(j.id);
  }
  await audit(req.user, 'cv_batch_upload', 'order', order.id, { batchId, files: req.files.length }, order.assigned_supplier_org_id);
  res.status(202).json({ batchId, files: out });
}));

router.get('/cv-batches/:batchId', wrap(async (req, res) => {
  const jobs = await db.query('SELECT id, order_id, supplier_org_id, filename, status, error, attempts, candidate_id, duplicate_of FROM cv_jobs WHERE batch_id = $1 ORDER BY id', [req.params.batchId]);
  if (!jobs.length) throw new HttpError(404, 'الدفعة غير موجودة');
  if (!isAdmin(req.user) && rolesIn(req.user, jobs[0].supplier_org_id).size === 0) throw new HttpError(403, 'الدفعة تخص مؤسسة أخرى');
  const count = (s) => jobs.filter((j) => j.status === s).length;
  res.json({ total: jobs.length, done: count('done'), failed: count('failed'), duplicate: count('duplicate'), pending: count('queued') + count('processing'), jobs });
}));

router.post('/cv-jobs/:id/retry', wrap(async (req, res) => {
  const job = await db.one('SELECT * FROM cv_jobs WHERE id = $1', [Number(req.params.id)]);
  if (!job) throw new HttpError(404, 'غير موجود');
  if (!isAdmin(req.user) && rolesIn(req.user, job.supplier_org_id).size === 0) throw new HttpError(403, 'لا تملك صلاحية');
  if (job.status !== 'failed') throw new HttpError(409, 'إعادة المحاولة للملفات المتعذرة فقط');
  await db.query("UPDATE cv_jobs SET status = 'queued' WHERE id = $1", [job.id]);
  enqueue(job.id);
  res.json({ ok: true });
}));

// ---------------- candidate access helpers ----------------
async function candidateAccess(user, candidateId, need) {
  const c = await db.one('SELECT * FROM candidates WHERE id = $1', [Number(candidateId)]);
  if (!c) throw new HttpError(404, 'المرشح غير موجود');
  const self = c.user_id && c.user_id === user.id;
  const supplierRoles = c.supplier_org_id ? rolesIn(user, c.supplier_org_id) : new Set();
  // Document viewing is a separate permission (doc_reviewer) from reviewing nominations.
  if (need === 'docs') {
    if (self || isAdmin(user) || supplierRoles.has('doc_reviewer')) return c;
    const orgs = user.memberships.filter((m) => m.role === 'doc_reviewer').map((m) => m.org_id);
    for (const orgId of orgs) {
      const hit = await db.one('SELECT n.id FROM nominations n JOIN orders o ON o.id = n.order_id WHERE n.candidate_id = $1 AND o.org_id = $2 LIMIT 1', [c.id, orgId]);
      if (hit) return c;
    }
    throw new HttpError(403, 'الاطلاع على الوثائق يتطلب صلاحية مراجعة الوثائق');
  }
  if (self || isAdmin(user) || supplierRoles.size > 0) return c;
  throw new HttpError(403, 'لا تملك صلاحية على هذا الملف');
}

router.get('/candidates/:id/fields', wrap(async (req, res) => {
  const c = await candidateAccess(req.user, req.params.id, 'edit');
  res.json({ candidate: { id: c.id, code: c.code }, fields: await db.query('SELECT * FROM cv_fields WHERE candidate_id = $1 ORDER BY id', [c.id]) });
}));

async function correctField(user, candidateId, fieldId, value) {
  const f = await db.one('SELECT * FROM cv_fields WHERE id = $1 AND candidate_id = $2', [Number(fieldId), candidateId]);
  if (!f) throw new HttpError(404, 'الحقل غير موجود');
  const v = value == null ? null : String(value).slice(0, 500);
  await db.query("UPDATE cv_fields SET value = $1, review_state = 'corrected', confidence = 1 WHERE id = $2", [v, f.id]);
  if (FIELD_TO_COLUMN[f.field]) await db.query(`UPDATE candidates SET ${FIELD_TO_COLUMN[f.field]} = $1 WHERE id = $2`, [v, candidateId]);
  if (f.field === 'experience_years') await db.query('UPDATE candidates SET years_exp = $1 WHERE id = $2', [parseInt(v, 10) || null, candidateId]);
  if (f.field === 'birth_date') await db.query('UPDATE candidates SET birth_date = $1 WHERE id = $2', [v || null, candidateId]);
  // Corrected data feeds matching for every live nomination.
  const c = await db.one('SELECT * FROM candidates WHERE id = $1', [candidateId]);
  const { match } = require('../lib/core');
  for (const n of await db.query('SELECT n.id, n.order_id FROM nominations n WHERE n.candidate_id = $1 AND n.replaced_at IS NULL', [candidateId])) {
    const order = await db.one('SELECT * FROM orders WHERE id = $1', [n.order_id]);
    const m = match(c, order);
    await db.query('UPDATE nominations SET score = $1, reasons = $2, review_reasons = $3, qualified = $4 WHERE id = $5', [m.score, JSON.stringify(m.reasons), JSON.stringify(m.reviewReasons), m.qualified, n.id]);
  }
  await audit(user, 'cv_field_corrected', 'candidate', candidateId, { field: f.field });
}

router.patch('/candidates/:id/fields/:fid', wrap(async (req, res) => {
  const c = await candidateAccess(req.user, req.params.id, 'edit');
  await correctField(req.user, c.id, req.params.fid, req.body.value);
  res.json({ ok: true });
}));

// ---------------- seeker self-service ----------------
async function myCandidate(user) {
  let c = await db.one('SELECT * FROM candidates WHERE user_id = $1', [user.id]);
  if (!c) c = await db.one('INSERT INTO candidates (code, user_id, full_name, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING *', [`W-${crypto.randomInt(20000, 99999)}`, user.id, user.name, user.phone, user.email]);
  return c;
}

router.get('/me/profile', wrap(async (req, res) => {
  const c = await myCandidate(req.user);
  const [fields, consents, documents, tasks, nominations] = await Promise.all([
    db.query('SELECT * FROM cv_fields WHERE candidate_id = $1 ORDER BY id', [c.id]),
    db.query('SELECT k.*, o.name AS recipient_name FROM consents k LEFT JOIN orgs o ON o.id = k.recipient_org_id WHERE k.candidate_id = $1 ORDER BY k.id', [c.id]),
    db.query('SELECT id, kind, filename, status, expires_on, created_at FROM documents WHERE candidate_id = $1 ORDER BY id', [c.id]),
    db.query("SELECT * FROM review_tasks WHERE candidate_id = $1 AND status = 'open'", [c.id]),
    db.query('SELECT n.id, n.approval, n.qualified, n.confirmed, n.started_at, o.title, o.city, o.code, g.name AS org_name FROM nominations n JOIN orders o ON o.id = n.order_id JOIN orgs g ON g.id = o.org_id WHERE n.candidate_id = $1', [c.id]),
  ]);
  res.json({ candidate: c, fields, consents, documents, tasks, nominations });
}));

router.patch('/me/profile', wrap(async (req, res) => {
  const c = await myCandidate(req.user);
  const b = req.body || {};
  await db.query(`UPDATE candidates SET profession = COALESCE($1, profession), specialty = COALESCE($2, specialty), accepted_cities = COALESCE($3, accepted_cities),
    accepts_relocation = COALESCE($4, accepts_relocation), available = COALESCE($5, available), available_from = COALESCE($6, available_from) WHERE id = $7`,
  [b.profession ?? null, b.specialty ?? null, b.acceptedCities ?? null, typeof b.acceptsRelocation === 'boolean' ? b.acceptsRelocation : null, typeof b.available === 'boolean' ? b.available : null, b.availableFrom ?? null, c.id]);
  await audit(req.user, 'profile_update', 'candidate', c.id, { keys: Object.keys(b) });
  res.json({ ok: true });
}));

router.post('/me/cv', cvUpload.single('file'), wrap(async (req, res) => {
  const c = await myCandidate(req.user);
  if (!req.file) throw new HttpError(422, 'أرفق السيرة');
  const t = sniff(req.file.buffer);
  if (!t || !CV_TYPES.includes(t.mime)) throw new HttpError(415, 'النوع غير مقبول (PDF أو DOCX فقط)');
  const key = await storage.put(req.file.buffer, t.ext);
  await db.query('INSERT INTO documents (candidate_id, kind, filename, mime, size, storage_key, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [c.id, 'cv', req.file.originalname.slice(0, 200), t.mime, req.file.size, key, req.user.id]);
  let text = await extractText(req.file.buffer, t.mime).catch(() => '');
  let warning;
  if (text.replace(/\s/g, '').length < 20) { try { text = await ocr(req.file.buffer); } catch (e) { warning = e.message; text = ''; } }
  const { fields } = await extractFields(text);
  await saveFields(c.id, fields);
  await audit(req.user, 'cv_upload_self', 'candidate', c.id, {});
  res.status(201).json({ ok: true, warning, fields: await db.query('SELECT * FROM cv_fields WHERE candidate_id = $1 ORDER BY id', [c.id]) });
}));

router.patch('/me/fields/:fid', wrap(async (req, res) => {
  const c = await myCandidate(req.user);
  await correctField(req.user, c.id, req.params.fid, req.body.value);
  res.json({ ok: true });
}));

router.post('/me/consents', wrap(async (req, res) => {
  const c = await myCandidate(req.user);
  const scope = String(req.body.scope || '');
  if (!['share_profile', 'share_contact', 'channel_whatsapp', 'channel_sms', 'channel_email', 'channel_telegram', 'marketing'].includes(scope)) throw new HttpError(422, 'نطاق غير معروف');
  const k = await db.one('INSERT INTO consents (candidate_id, recipient_org_id, scope) VALUES ($1,$2,$3) RETURNING *', [c.id, req.body.recipientOrgId ? Number(req.body.recipientOrgId) : null, scope]);
  await audit(req.user, 'consent_grant', 'consent', k.id, { scope, recipient: req.body.recipientOrgId || null });
  res.status(201).json(k);
}));

router.post('/me/consents/:id/withdraw', wrap(async (req, res) => {
  const c = await myCandidate(req.user);
  const k = await db.one('SELECT * FROM consents WHERE id = $1 AND candidate_id = $2', [Number(req.params.id), c.id]);
  if (!k) throw new HttpError(404, 'الموافقة غير موجودة');
  await db.query('UPDATE consents SET withdrawn_at = $1 WHERE id = $2', [new Date(), k.id]);
  await audit(req.user, 'consent_withdraw', 'consent', k.id, { scope: k.scope });
  res.json({ ok: true, note: 'يسري السحب على المشاركات والرسائل المستقبلية؛ المشاركات السابقة تبقى في سجل التدقيق.' });
}));

// ---------------- documents (iqama, permit, Ajeer contract...) ----------------
router.post('/candidates/:id/documents', docUpload.single('file'), wrap(async (req, res) => {
  const c = await candidateAccess(req.user, req.params.id, 'edit');
  const kind = String(req.body.kind || '');
  if (!['iqama', 'work_permit', 'ajeer_contract', 'certificate'].includes(kind)) throw new HttpError(422, 'نوع الوثيقة غير معروف');
  if (!req.file) throw new HttpError(422, 'أرفق الملف');
  const t = sniff(req.file.buffer);
  if (!t || !DOC_TYPES.includes(t.mime)) throw new HttpError(415, 'النوع غير مقبول (PDF أو JPG أو PNG)');
  const key = await storage.put(req.file.buffer, t.ext);
  const expires = req.body.expiresOn || null;
  const expired = expires && new Date(expires) < new Date();
  const d = await db.one('INSERT INTO documents (candidate_id, kind, filename, mime, size, storage_key, status, expires_on, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, kind, status',
    [c.id, kind, req.file.originalname.slice(0, 200), t.mime, req.file.size, key, expired ? 'expired' : 'uploaded', expires, req.user.id]);
  if (expired) {
    await db.query("UPDATE candidates SET verification = 'doc_expired' WHERE id = $1", [c.id]);
    await db.query('INSERT INTO review_tasks (candidate_id, reason, action_for_candidate) VALUES ($1,$2,$3)', [c.id, `وثيقة ${kind} منتهية`, 'ارفع نسخة سارية من الوثيقة']);
  }
  await audit(req.user, 'document_upload', 'document', d.id, { kind, expired: !!expired });
  res.status(201).json(d);
}));

router.post('/documents/:id/manual-verify', wrap(async (req, res) => {
  const d = await db.one('SELECT * FROM documents WHERE id = $1', [Number(req.params.id)]);
  if (!d) throw new HttpError(404, 'غير موجود');
  await candidateAccess(req.user, d.candidate_id, 'docs');
  await db.query("UPDATE documents SET status = 'verified_manual' WHERE id = $1", [d.id]);
  // "Manually verified" is a distinct state from verification by an external authority.
  await db.query("UPDATE candidates SET verification = 'manual_verified', work_eligibility = CASE WHEN $2 IN ('iqama','work_permit') THEN 'eligible' ELSE work_eligibility END WHERE id = $1", [d.candidate_id, d.kind]);
  await audit(req.user, 'document_manual_verify', 'document', d.id, {});
  res.json({ ok: true, state: 'manual_verified' });
}));

router.get('/candidates/:id/documents', wrap(async (req, res) => {
  const c = await candidateAccess(req.user, req.params.id, 'docs');
  const docs = await db.query('SELECT id, kind, filename, mime, status, expires_on FROM documents WHERE candidate_id = $1 ORDER BY id', [c.id]);
  await audit(req.user, 'documents_list_sensitive', 'candidate', c.id, { count: docs.length });
  res.json({ items: docs.map((d) => ({ ...d, url: storage.sign(d.id, req.user.id) })) });
}));

router.get('/files/:docId', wrap(async (req, res) => {
  const { u, exp, sig } = req.query;
  if (Number(u) !== req.user.id || !storage.verify(req.params.docId, u, exp, sig)) throw new HttpError(403, 'الرابط منتهي أو غير مصرح');
  const d = await db.one('SELECT * FROM documents WHERE id = $1', [Number(req.params.docId)]);
  if (!d) throw new HttpError(404, 'غير موجود');
  await candidateAccess(req.user, d.candidate_id, 'docs');
  await audit(req.user, 'document_view', 'document', d.id, { kind: d.kind });
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(await storage.get(d.storage_key));
}));

module.exports = { router, idle, processJob };
