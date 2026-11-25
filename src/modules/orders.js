// [MOD-ORDERS] [MOD-NOMINATIONS] [MOD-REPORTS] [MOD-MESSAGING]
const crypto = require('crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { channels, sendBatch } = require('../providers');
const { audit, HttpError, assertOrder, rolesIn, match, orderKpis } = require('../lib/core');
const { requireUser } = require('./auth');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const getOrder = (id) => db.one('SELECT * FROM orders WHERE id = $1', [Number(id)]);
const getNomination = (id) => db.one('SELECT * FROM nominations WHERE id = $1', [Number(id)]);

async function activeConsents(orgId) {
  const rows = await db.query('SELECT candidate_id, scope FROM consents WHERE (recipient_org_id = $1 OR recipient_org_id IS NULL) AND withdrawn_at IS NULL', [orgId]);
  const map = new Map();
  for (const r of rows) { if (!map.has(r.candidate_id)) map.set(r.candidate_id, new Set()); map.get(r.candidate_id).add(r.scope); }
  return map;
}

// Company members see identity only with consent; suppliers see the records they own.
function present(row, sc, consents) {
  const own = sc.isSupplier || sc.admin;
  const cs = consents.get(row.candidate_id) || new Set();
  const showName = own || cs.has('share_profile');
  const showContact = own || cs.has('share_contact');
  return {
    nominationId: row.id, candidateId: row.candidate_id, code: row.code,
    name: showName ? row.full_name : null, phone: showContact ? row.phone : null, email: showContact ? row.email : null,
    profession: row.profession, specialty: row.specialty, skills: row.skills, certs: row.certs, yearsExp: row.years_exp,
    city: row.city, acceptsRelocation: row.accepts_relocation, available: row.available, availableFrom: row.available_from,
    verification: row.verification, workEligibility: row.work_eligibility, cvComplete: row.cv_complete,
    score: row.score, reasons: JSON.parse(row.reasons || '[]'), reviewReasons: JSON.parse(row.review_reasons || '[]'),
    qualified: row.qualified, confirmed: row.confirmed, contactNote: row.contact_note, interviewedAt: row.interviewed_at,
    techReview: row.tech_review, approval: row.approval, approvalReason: row.approval_reason, startedAt: row.started_at,
    replacedAt: row.replaced_at, replaceReason: row.replace_reason, replacesNominationId: row.replaces_nomination_id,
    replacedByNominationId: row.replaced_by_nomination_id,
  };
}

// ---------- public job board (published orders only, no candidate data) ----------
router.get('/jobs', wrap(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(50, Number(req.query.pageSize) || 20);
  const where = ["o.visibility = 'public'", "o.status IN ('approved','assigned')"];
  const params = [];
  if (req.query.kind) { params.push(req.query.kind); where.push(`o.kind = $${params.length}`); }
  if (req.query.city) { params.push(req.query.city); where.push(`o.city = $${params.length}`); }
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(o.title ILIKE $${params.length} OR o.profession ILIKE $${params.length} OR o.city ILIKE $${params.length})`); }
  params.push(size, (page - 1) * size);
  const rows = await db.query(`SELECT o.id, o.code, o.kind, o.title, o.profession, o.quantity, o.city, o.site, o.duration, o.shifts, o.start_date, g.name AS org_name, g.verification AS org_verification
    FROM orders o JOIN orgs g ON g.id = o.org_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  res.json({ page, pageSize: size, items: rows });
}));

router.use(requireUser);

// ---------- orders ----------
router.get('/orders', wrap(async (req, res) => {
  const orgIds = req.user.memberships.map((m) => m.org_id);
  const rows = req.user.kind === 'platform_admin'
    ? await db.query('SELECT o.*, g.name AS org_name FROM orders o JOIN orgs g ON g.id = o.org_id ORDER BY o.id DESC')
    : (await db.query('SELECT o.*, g.name AS org_name FROM orders o JOIN orgs g ON g.id = o.org_id ORDER BY o.id DESC'))
      .filter((o) => orgIds.includes(o.org_id) || orgIds.includes(o.assigned_supplier_org_id));
  res.json({ items: rows });
}));

router.post('/orders', wrap(async (req, res) => {
  const b = req.body || {};
  const orgId = Number(b.orgId);
  const roles = rolesIn(req.user, orgId);
  if (!['creator', 'single_admin', 'approver'].some((r) => roles.has(r))) throw new HttpError(403, 'لا تملك صلاحية إنشاء طلب لهذه المنشأة');
  for (const f of ['title', 'profession', 'city']) if (!b[f]) throw new HttpError(422, `الحقل مطلوب: ${f}`);
  const qty = Number(b.quantity);
  if (!Number.isInteger(qty) || qty < 1 || qty > 5000) throw new HttpError(422, 'العدد غير صالح');
  const code = `ORD-${new Date().getFullYear()}-${crypto.randomInt(1000, 9999)}`;
  const o = await db.one(`INSERT INTO orders (code, org_id, kind, title, profession, specialties, quantity, city, site, duration, shifts, start_date, required_certs, required_skills, requires_work_permit, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
  [code, orgId, b.kind === 'direct' ? 'direct' : 'supply', b.title, b.profession, b.specialties || null, qty, b.city, b.site || null, b.duration || null, b.shifts || null, b.startDate || null, b.requiredCerts || null, b.requiredSkills || null, b.requiresWorkPermit !== false, req.user.id]);
  await audit(req.user, 'order_create', 'order', o.id, { code }, orgId);
  res.status(201).json(o);
}));

router.get('/orders/:id', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  const sc = assertOrder(req.user, order, 'read');
  res.json({ order, kpis: await orderKpis(order), scope: { owner: [...sc.owner], supplier: [...sc.supplier], admin: sc.admin } });
}));

router.post('/orders/:id/approve', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  assertOrder(req.user, order, 'approve_order');
  if (order.status !== 'draft') throw new HttpError(409, 'الطلب معتمد مسبقًا');
  await db.query("UPDATE orders SET status = 'approved', approved_by = $1 WHERE id = $2", [req.user.id, order.id]);
  await audit(req.user, 'order_approve', 'order', order.id, {}, order.org_id);
  res.json({ ok: true });
}));

router.post('/orders/:id/assign', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  assertOrder(req.user, order, 'assign');
  if (order.status === 'draft') throw new HttpError(409, 'اعتمد الطلب قبل إسناده لمورد');
  const sup = await db.one("SELECT * FROM orgs WHERE id = $1 AND type = 'supplier'", [Number(req.body.supplierOrgId)]);
  if (!sup) throw new HttpError(422, 'المورد غير موجود');
  await db.query("UPDATE orders SET status = 'assigned', assigned_supplier_org_id = $1 WHERE id = $2", [sup.id, order.id]);
  await audit(req.user, 'order_assign', 'order', order.id, { supplier: sup.id, supplierVerification: sup.verification }, order.org_id);
  res.json({ ok: true, warning: sup.verification === 'pending' ? 'المورد لم يُتحقق منه بعد' : undefined });
}));

// ---------- nominations: list, filter, paginate ----------
router.get('/orders/:id/nominations', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  const sc = assertOrder(req.user, order, 'read');
  const where = ['n.order_id = $1'];
  const params = [order.id];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.specialty) add('c.specialty = ?', req.query.specialty);
  if (req.query.city) add('c.city = ?', req.query.city);
  if (req.query.verification) add('c.verification = ?', req.query.verification);
  if (req.query.skill) add('c.skills ILIKE ?', `%${req.query.skill}%`);
  if (req.query.minExp) add('c.years_exp >= ?', Number(req.query.minExp));
  if (req.query.available === 'true') where.push('c.available = true');
  if (req.query.list === 'primary') where.push("n.approval = 'primary'");
  if (req.query.list === 'backup') where.push("n.approval = 'backup'");
  if (req.query.list === 'review') where.push('n.qualified = false');
  if (req.query.includeReplaced !== 'true') where.push('n.replaced_at IS NULL');
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.min(200, Number(req.query.pageSize) || 50);
  const total = (await db.one(`SELECT COUNT(*)::int AS n FROM nominations n JOIN candidates c ON c.id = n.candidate_id WHERE ${where.join(' AND ')}`, params)).n;
  params.push(size, (page - 1) * size);
  const rows = await db.query(`SELECT n.*, c.code, c.full_name, c.phone, c.email, c.profession, c.specialty, c.skills, c.certs, c.years_exp, c.city, c.accepts_relocation, c.available, c.available_from, c.verification, c.work_eligibility, c.cv_complete
    FROM nominations n JOIN candidates c ON c.id = n.candidate_id WHERE ${where.join(' AND ')} ORDER BY n.score DESC, n.id ASC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
  const consents = await activeConsents(order.org_id);
  res.json({ total, page, pageSize: size, items: rows.map((r) => present(r, sc, consents)) });
}));

async function nominate(user, order, candidate, nominatedByOrg, extra = {}) {
  const dup = await db.one('SELECT id FROM nominations WHERE order_id = $1 AND candidate_id = $2', [order.id, candidate.id]);
  if (dup) throw new HttpError(409, `المرشح ${candidate.code} مضاف مسبقًا لهذا الطلب`, 'duplicate_nomination');
  const m = match(candidate, order);
  const n = await db.one(`INSERT INTO nominations (order_id, candidate_id, nominated_by_org_id, score, reasons, review_reasons, qualified, replaces_nomination_id, approval)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
  [order.id, candidate.id, nominatedByOrg, m.score, JSON.stringify(m.reasons), JSON.stringify(m.reviewReasons), m.qualified, extra.replaces || null, extra.approval || 'none']);
  await audit(user, 'nominate', 'nomination', n.id, { order: order.code, candidate: candidate.code, score: m.score }, nominatedByOrg);
  return n;
}

router.post('/orders/:id/nominations', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  const sc = assertOrder(req.user, order, 'nominate');
  const code = String(req.body.candidateCode || '').trim().toUpperCase();
  const c = await db.one('SELECT * FROM candidates WHERE code = $1', [code]);
  if (!c) throw new HttpError(404, 'المرشح غير موجود');
  if (sc.isSupplier && !sc.admin && c.supplier_org_id !== order.assigned_supplier_org_id) throw new HttpError(403, 'هذا المرشح ليس ضمن مرشحي مؤسستك');
  const n = await nominate(req.user, order, c, sc.isSupplier ? order.assigned_supplier_org_id : order.org_id);
  res.status(201).json(n);
}));

async function nominationContext(req, action) {
  const n = await getNomination(req.params.id);
  if (!n) throw new HttpError(404, 'الترشيح غير موجود');
  const order = await getOrder(n.order_id);
  const sc = assertOrder(req.user, order, action);
  return { n, order, sc };
}

router.post('/nominations/:id/contact', wrap(async (req, res) => {
  const { n, order } = await nominationContext(req, 'contact');
  const note = String(req.body.note || '').slice(0, 1000);
  if (!note) throw new HttpError(422, 'وثّق رد المرشح');
  const confirmed = req.body.confirmed === true;
  if (confirmed && !n.qualified) throw new HttpError(422, 'لا يمكن تأكيد مرشح غير مؤهل قبل مراجعة ملفه');
  await db.query('UPDATE nominations SET confirmed = $1, contact_note = $2 WHERE id = $3', [confirmed, note, n.id]);
  await audit(req.user, 'contact_logged', 'nomination', n.id, { confirmed, note }, order.org_id);
  res.json({ ok: true });
}));

router.post('/nominations/:id/tech-review', wrap(async (req, res) => {
  const { n, order } = await nominationContext(req, 'tech_review');
  const decision = req.body.decision;
  if (!['passed', 'returned'].includes(decision)) throw new HttpError(422, 'القرار غير صالح');
  if (decision === 'returned' && !req.body.reason) throw new HttpError(422, 'اذكر سبب الإرجاع');
  await db.query('UPDATE nominations SET tech_review = $1, approval_reason = $2 WHERE id = $3', [decision, req.body.reason || null, n.id]);
  await audit(req.user, `tech_review_${decision}`, 'nomination', n.id, { reason: req.body.reason }, order.org_id);
  res.json({ ok: true });
}));

router.post('/nominations/:id/approval', wrap(async (req, res) => {
  const { n, order, sc } = await nominationContext(req, 'final_approve');
  const approval = req.body.approval;
  const reason = req.body.reason ? String(req.body.reason).slice(0, 500) : null;
  if (!['primary', 'backup', 'returned'].includes(approval)) throw new HttpError(422, 'نوع الاعتماد غير صالح');
  if (approval === 'returned' && !reason) throw new HttpError(422, 'سبب الإرجاع للتعديل مطلوب');
  if (approval !== 'returned' && !n.qualified) throw new HttpError(422, 'المرشح يحتاج مراجعة ولا يمكن اعتماده');
  if (n.replaced_at) throw new HttpError(409, 'هذا الترشيح مستبدَل');
  // Large companies: final approval only after the technical reviewer; small companies use one authorized role.
  const large = (await db.one('SELECT type FROM orgs WHERE id = $1', [order.org_id])).type === 'company_large';
  if (large && approval !== 'returned' && n.tech_review !== 'passed' && !sc.owner.has('single_admin')) throw new HttpError(409, 'ينتظر مراجعة المراجع الفني قبل الاعتماد النهائي');
  await db.query('UPDATE nominations SET approval = $1, approval_reason = $2 WHERE id = $3', [approval, reason, n.id]);
  await audit(req.user, `approval_${approval}`, 'nomination', n.id, { reason }, order.org_id);
  res.json({ ok: true });
}));

router.post('/nominations/:id/interview', wrap(async (req, res) => {
  const { n, order } = await nominationContext(req, 'record_progress');
  const at = req.body.at ? new Date(req.body.at) : new Date();
  await db.query('UPDATE nominations SET interviewed_at = $1 WHERE id = $2', [at, n.id]);
  await audit(req.user, 'interview_logged', 'nomination', n.id, { at, outcome: req.body.outcome }, order.org_id);
  res.json({ ok: true });
}));

router.post('/nominations/:id/start', wrap(async (req, res) => {
  const { n, order } = await nominationContext(req, 'record_progress');
  if (n.approval !== 'primary') throw new HttpError(409, 'المباشرة تُسجَّل للمعتمدين في القائمة الأساسية فقط');
  await db.query('UPDATE nominations SET started_at = $1 WHERE id = $2', [req.body.at ? new Date(req.body.at) : new Date(), n.id]);
  await audit(req.user, 'start_logged', 'nomination', n.id, {}, order.org_id);
  res.json({ ok: true });
}));

router.post('/nominations/:id/replace', wrap(async (req, res) => {
  const { n, order, sc } = await nominationContext(req, 'final_approve');
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new HttpError(422, 'سبب الاستبدال مطلوب');
  if (n.replaced_at) throw new HttpError(409, 'الترشيح مستبدَل مسبقًا');
  const c = await db.one('SELECT * FROM candidates WHERE code = $1', [String(req.body.newCandidateCode || '').toUpperCase()]);
  if (!c) throw new HttpError(404, 'المرشح البديل غير موجود');
  const existing = await db.one('SELECT * FROM nominations WHERE order_id = $1 AND candidate_id = $2', [order.id, c.id]);
  let newId;
  if (existing) {
    if (existing.approval !== 'backup') throw new HttpError(409, `المرشح ${c.code} مضاف مسبقًا لهذا الطلب`, 'duplicate_nomination');
    if (!existing.qualified) throw new HttpError(422, 'البديل يحتاج مراجعة');
    await db.query("UPDATE nominations SET approval = 'primary', replaces_nomination_id = $1 WHERE id = $2", [n.id, existing.id]);
    newId = existing.id;
  } else {
    const created = await nominate(req.user, order, c, sc.isSupplier ? order.assigned_supplier_org_id : order.org_id, { replaces: n.id, approval: 'primary' });
    if (!created.qualified) {
      await db.query("UPDATE nominations SET approval = 'none' WHERE id = $1", [created.id]);
      throw new HttpError(422, 'أُضيف البديل لكنه يحتاج مراجعة قبل اعتماده');
    }
    newId = created.id;
  }
  const now = new Date();
  await db.query('UPDATE nominations SET replaced_at = $1, replace_reason = $2, replaced_by_nomination_id = $3 WHERE id = $4', [now, reason, newId, n.id]);
  await audit(req.user, 'replace', 'nomination', n.id, { newNomination: newId, reason, at: now }, order.org_id);
  res.json({ ok: true, newNominationId: newId });
}));

// ---------- [MOD-REPORTS] XLSX export ----------
const COLS = {
  code: ['معرّف المرشح', 'Candidate ID'], profession: ['المهنة', 'Profession'], skills: ['المهارات', 'Skills'],
  yearsExp: ['سنوات الخبرة', 'Years of experience'], city: ['المدينة', 'City'], available: ['التوفر', 'Availability'],
  nominationStatus: ['حالة الترشيح', 'Nomination status'], approval: ['حالة الاعتماد', 'Approval status'],
  name: ['الاسم', 'Name'], phone: ['الجوال', 'Mobile'], email: ['البريد', 'Email'],
};
const DEFAULT_COLS = ['code', 'profession', 'skills', 'yearsExp', 'city', 'available', 'nominationStatus', 'approval'];

// Neutralize spreadsheet formula injection (=, +, -, @, tab, CR at start of a cell).
const safeCell = (v) => {
  if (v == null) return '';
  if (typeof v === 'number') return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

router.get('/orders/:id/export.xlsx', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  const sc = assertOrder(req.user, order, 'export');
  const lang = req.query.lang === 'en' ? 1 : 0;
  const wantContact = req.query.contact === '1';
  if (wantContact) assertOrder(req.user, order, 'export_contact');
  const list = req.query.list === 'backup' ? 'backup' : 'primary';
  const rows = await db.query(`SELECT n.*, c.code, c.full_name, c.phone, c.email, c.profession, c.skills, c.years_exp, c.city, c.available
    FROM nominations n JOIN candidates c ON c.id = n.candidate_id WHERE n.order_id = $1 AND n.approval = $2 AND n.replaced_at IS NULL ORDER BY n.score DESC`, [order.id, list]);
  const consents = await activeConsents(order.org_id);
  const cols = wantContact ? [...DEFAULT_COLS, 'name', 'phone', 'email'] : DEFAULT_COLS;
  const st = (r) => (r.started_at ? 'باشر' : r.interviewed_at ? 'قوبل' : r.confirmed ? 'مؤكد' : r.qualified ? 'مؤهل' : 'يحتاج مراجعة');
  const ap = { primary: 'معتمد أساسي', backup: 'احتياطي', returned: 'أُرجع للتعديل', none: '—' };
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(lang ? 'Candidates' : 'المرشحون', { views: [{ rightToLeft: !lang }] });
  ws.columns = cols.map((k) => ({ header: COLS[k][lang], key: k, width: 20 }));
  let withheld = 0;
  for (const r of rows) {
    const cs = consents.get(r.candidate_id) || new Set();
    const contactOk = cs.has('share_contact');
    if (wantContact && !contactOk) withheld++;
    const rec = { code: r.code, profession: r.profession, skills: r.skills, yearsExp: r.years_exp, city: r.city, available: r.available ? 'متاح' : 'غير متاح', nominationStatus: st(r), approval: ap[r.approval] };
    if (wantContact) Object.assign(rec, { name: contactOk ? r.full_name : '', phone: contactOk ? r.phone : '', email: contactOk ? r.email : '' });
    const safe = {}; for (const k of cols) safe[k] = safeCell(rec[k]);
    ws.addRow(safe);
  }
  ws.getRow(1).font = { bold: true };
  await audit(req.user, 'export_xlsx', 'order', order.id, { list, rows: rows.length, fields: cols, contactWithheld: withheld, as: sc.isSupplier ? 'supplier' : 'company' }, order.org_id);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${order.code}-${list}.xlsx"`);
  res.setHeader('X-Contact-Withheld', String(withheld));
  await wb.xlsx.write(res);
  res.end();
}));

// ---------- [MOD-MESSAGING] templates, preview, idempotent bulk send ----------
const TEMPLATES = {
  invite: 'مرحبًا {name}، رُشّحت لطلب «{title}» في {city}. للاطلاع والرد افتح ملفك في وصلة عمل.',
  availability: 'مرحبًا {name}، هل ما زلت متاحًا للمباشرة بتاريخ {start}؟ ردّ بنعم أو لا.',
  interview: 'مرحبًا {name}، موعد مقابلتك لطلب «{title}»: {when}.',
  missing_doc: 'مرحبًا {name}، ينقص ملفك مستند مطلوب. ارفعه من صفحة ملفك في وصلة عمل.',
  start_confirm: 'مرحبًا {name}، تم تأكيد مباشرتك في {site} بتاريخ {start}.',
};
const CHANNEL_SCOPE = { whatsapp: 'channel_whatsapp', sms: 'channel_sms', email: 'channel_email', telegram: 'channel_telegram' };

async function recipients(order, channel) {
  const scope = CHANNEL_SCOPE[channel];
  if (!scope) throw new HttpError(422, 'قناة غير معروفة');
  return db.query(`SELECT c.id, c.full_name, c.phone FROM nominations n JOIN candidates c ON c.id = n.candidate_id
    JOIN consents k ON k.candidate_id = c.id AND k.scope = $2 AND k.withdrawn_at IS NULL
    WHERE n.order_id = $1 AND n.qualified = true AND n.replaced_at IS NULL`, [order.id, scope]);
}

function render(tpl, order, r) {
  return TEMPLATES[tpl].replace('{name}', r.full_name || '').replace('{title}', order.title).replace('{city}', order.city)
    .replace('{start}', order.start_date ? new Date(order.start_date).toISOString().slice(0, 10) : '—').replace('{site}', order.site || order.city).replace('{when}', '[يحدد لاحقًا]');
}

router.get('/orders/:id/messages/preview', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  assertOrder(req.user, order, 'message');
  if (!TEMPLATES[req.query.template]) throw new HttpError(422, 'قالب غير معروف');
  const list = await recipients(order, req.query.channel);
  const qualified = (await orderKpis(order)).qualified;
  res.json({ channel: req.query.channel, template: req.query.template, recipients: list.length, withoutConsent: qualified - list.length,
    sample: list[0] ? render(req.query.template, order, list[0]) : render(req.query.template, order, { full_name: '{الاسم}' }),
    manualLink: req.query.channel === 'whatsapp' && list[0] ? channels.whatsapp.manualLink(list[0].phone, render(req.query.template, order, list[0])) : undefined });
}));

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
// WhatsApp template body variables, in {{1}}, {{2}}, {{3}} order (document the same order in Meta WhatsApp Manager).
const TEMPLATE_VARS = {
  invite: (o, r) => [r.full_name, o.title, o.city],
  availability: (o, r) => [r.full_name, day(o.start_date)],
  interview: (o, r) => [r.full_name, o.title, '[يحدد لاحقًا]'],
  missing_doc: (o, r) => [r.full_name],
  start_confirm: (o, r) => [r.full_name, o.site || o.city, day(o.start_date)],
};

async function messageSummary(msg) {
  const rows = await db.query('SELECT status, COUNT(*)::int AS n FROM message_deliveries WHERE message_id = $1 GROUP BY status', [msg.id]);
  const counts = {}; for (const r of rows) counts[r.status] = r.n;
  return { ...msg, counts };
}

router.post('/orders/:id/messages', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  assertOrder(req.user, order, 'message');
  const { channel, template, idempotencyKey } = req.body || {};
  if (!TEMPLATES[template]) throw new HttpError(422, 'قالب غير معروف');
  if (!idempotencyKey || String(idempotencyKey).length < 8) throw new HttpError(422, 'مفتاح منع التكرار مطلوب');
  const key = String(idempotencyKey).slice(0, 100);
  const existing = await db.one('SELECT * FROM messages WHERE idempotency_key = $1', [key]);
  if (existing) return res.json({ duplicate: true, message: await messageSummary(existing) });
  const list = await recipients(order, channel);
  // Reserve the key before contacting any provider, so a retry or double click can never send twice.
  let msg;
  try {
    msg = await db.one("INSERT INTO messages (idempotency_key, order_id, channel, template, recipient_count, status, created_by) VALUES ($1,$2,$3,$4,$5,'sending',$6) RETURNING *",
      [key, order.id, channel, template, list.length, req.user.id]);
  } catch (e) {
    const again = await db.one('SELECT * FROM messages WHERE idempotency_key = $1', [key]);
    if (again) return res.json({ duplicate: true, message: await messageSummary(again) });
    throw e;
  }
  let result;
  try {
    result = await sendBatch(channel, list, (r) => render(template, order, r), template, (r) => TEMPLATE_VARS[template](order, r));
  } catch (e) {
    await db.query("UPDATE messages SET status = 'failed' WHERE id = $1", [msg.id]);
    await audit(req.user, 'message_bulk_failed', 'order', order.id, { channel, template, error: e.message }, order.org_id);
    throw new HttpError(424, e.message, 'provider_error');
  }
  for (const r of result.results) {
    await db.query('INSERT INTO message_deliveries (message_id, candidate_id, to_address, provider_message_id, status, error) VALUES ($1,$2,$3,$4,$5,$6)',
      [msg.id, r.candidateId, r.to || '', r.providerMessageId || null, r.status, r.error || null]);
  }
  await db.query('UPDATE messages SET status = $1 WHERE id = $2', [result.status, msg.id]);
  await audit(req.user, 'message_bulk', 'order', order.id, { channel, template, recipients: list.length, status: result.status }, order.org_id);
  res.status(201).json({ duplicate: false, message: await messageSummary({ ...msg, status: result.status }) });
}));

router.get('/orders/:id/messages', wrap(async (req, res) => {
  const order = await getOrder(req.params.id);
  assertOrder(req.user, order, 'message');
  const rows = await db.query('SELECT * FROM messages WHERE order_id = $1 ORDER BY id DESC LIMIT 20', [order.id]);
  res.json({ items: await Promise.all(rows.map(messageSummary)) });
}));

module.exports = { router, nominate, TEMPLATES };
