// [MOD-AUDIT] [MOD-ORGS] [MOD-NOMINATIONS] shared core: audit log, authorization, matching.
const db = require('../db');

// ---------------- [MOD-AUDIT] ----------------
async function audit(user, action, entity, entityId, details = {}, orgId = null) {
  await db.query(
    'INSERT INTO audit_log (user_id, org_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5,$6)',
    [user ? user.id : null, orgId, action, entity, entityId == null ? null : String(entityId), JSON.stringify(details)],
  );
}

// ---------------- [MOD-ORGS] authorization ----------------
class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const deny = (msg = 'لا تملك صلاحية لهذا الإجراء') => new HttpError(403, msg, 'forbidden');

function rolesIn(user, orgId) {
  return new Set(user.memberships.filter((m) => m.org_id === orgId).map((m) => m.role));
}
const isAdmin = (user) => user && user.kind === 'platform_admin';
const any = (set, list) => list.some((r) => set.has(r));

const ORDER_ACTIONS = {
  read: (o, s, a) => a || o.size > 0 || s.size > 0,
  approve_order: (o) => any(o, ['approver', 'single_admin']),
  assign: (o) => any(o, ['approver', 'single_admin', 'creator']),
  tech_review: (o) => any(o, ['tech_reviewer', 'approver', 'single_admin']),
  final_approve: (o) => any(o, ['approver', 'single_admin']),
  nominate: (o, s) => s.has('supplier_agent') || any(o, ['creator', 'single_admin']),
  contact: (o, s) => s.has('supplier_agent') || any(o, ['creator', 'approver', 'single_admin']),
  record_progress: (o) => o.size > 0,
  export: (o, s) => s.has('supplier_agent') || any(o, ['creator', 'approver', 'single_admin']),
  export_contact: (o) => any(o, ['approver', 'single_admin']),
  message: (o, s) => s.has('supplier_agent') || any(o, ['creator', 'approver', 'single_admin']),
};

function orderScope(user, order) {
  const owner = rolesIn(user, order.org_id);
  const supplier = order.assigned_supplier_org_id ? rolesIn(user, order.assigned_supplier_org_id) : new Set();
  return { owner, supplier, admin: isAdmin(user), isOwner: owner.size > 0, isSupplier: supplier.size > 0 };
}

function assertOrder(user, order, action) {
  if (!user) throw new HttpError(401, 'سجّل الدخول أولًا', 'unauthenticated');
  if (!order) throw new HttpError(404, 'الطلب غير موجود', 'not_found');
  const sc = orderScope(user, order);
  // Isolation: an org that is neither owner nor assigned supplier gets 404-like denial, even for reads.
  if (!ORDER_ACTIONS.read(sc.owner, sc.supplier, sc.admin)) throw deny('هذا الطلب يخص مؤسسة أخرى');
  if (action !== 'read' && !(ORDER_ACTIONS[action] && ORDER_ACTIONS[action](sc.owner, sc.supplier, sc.admin))) throw deny();
  return sc;
}

// ---------------- [MOD-NOMINATIONS] matching ----------------
const split = (s) => String(s || '').split(/[,،;]/).map((x) => x.trim()).filter(Boolean);

function match(c, order) {
  const reasons = [];
  const review = [];
  let score = 0;
  const prof = (c.profession || '').includes(order.profession) || (order.profession === 'كهربائي' && /electric/i.test(c.profession || ''));
  if (prof) { score += 30; reasons.push(`المهنة مطابقة: ${c.profession}`); } else review.push('المهنة غير مطابقة للطلب');
  if (split(order.specialties).includes(c.specialty)) { score += 15; reasons.push(`التخصص ضمن المطلوب: ${c.specialty}`); }
  if (c.years_exp != null) { score += Math.min(c.years_exp, 10) * 2; reasons.push(`خبرة ${c.years_exp} سنوات`); } else review.push('سنوات الخبرة غير مذكورة');
  const certs = split(c.certs);
  const hitCerts = split(order.required_certs).filter((x) => certs.includes(x));
  if (hitCerts.length) { score += 15; reasons.push(`شهادات مطلوبة: ${hitCerts.join('، ')}`); }
  else if (split(order.required_certs).length) review.push('لا تظهر الشهادات المطلوبة');
  const skills = split(c.skills);
  const hitSkills = split(order.required_skills).filter((x) => skills.includes(x));
  if (hitSkills.length) { score += Math.min(10, hitSkills.length * 5); reasons.push(`مهارات: ${hitSkills.join('، ')}`); }
  const accepts = c.city === order.city || split(c.accepted_cities).includes(order.city) || c.accepts_relocation;
  if (accepts) { score += 10; reasons.push(c.city === order.city ? `في ${order.city}` : `يقبل العمل في ${order.city}`); }
  else review.push(`لا يقبل العمل في موقع المشروع (${order.city})`);
  const startOk = c.available && (!c.available_from || !order.start_date || new Date(c.available_from) <= new Date(order.start_date));
  if (startOk) reasons.push('متاح قبل موعد المباشرة'); else review.push('التوفر لا يطابق موعد المباشرة');
  if (c.verification === 'doc_expired') review.push('وثيقة منتهية الصلاحية');
  if (order.requires_work_permit && c.work_eligibility !== 'eligible') review.push('أهلية العمل غير مؤكدة (تصريح/إقامة)');
  if (!c.cv_complete) review.push('السيرة ناقصة');
  return { score: Math.min(100, score), reasons, reviewReasons: review, qualified: review.length === 0 };
}

// ---------------- [RULE-KPI] order dashboard figures ----------------
async function orderKpis(order) {
  const rows = await db.query('SELECT qualified, confirmed, interviewed_at, approval, started_at, replaced_at FROM nominations WHERE order_id = $1', [order.id]);
  const live = rows.filter((r) => !r.replaced_at);
  const qualified = live.filter((r) => r.qualified).length;
  const started = live.filter((r) => r.started_at).length;
  return {
    required: order.quantity,
    nominated: live.length,
    qualified,
    gap: Math.max(0, order.quantity - qualified),
    confirmed: live.filter((r) => r.confirmed).length,
    interviewed: live.filter((r) => r.interviewed_at).length,
    approved: live.filter((r) => r.approval === 'primary').length,
    backup: live.filter((r) => r.approval === 'backup').length,
    started,
    remaining: Math.max(0, order.quantity - started),
    replaced: rows.length - live.length,
    definitions: {
      required: 'العدد المطلوب في الطلب المعتمد',
      nominated: 'كل الترشيحات السارية (بدون المستبدَلين)',
      qualified: 'ترشيحات طابقت كل الشروط دون أسباب مراجعة',
      gap: 'المطلوب − المؤهل',
      confirmed: 'مؤهلون أكدوا توفرهم بعد التواصل الموثّق',
      interviewed: 'سُجّلت لهم مقابلة',
      approved: 'اعتمدهم المعتمد النهائي في القائمة الأساسية',
      backup: 'القائمة الاحتياطية المنفصلة',
      started: 'باشروا فعليًا في الموقع',
      remaining: 'المطلوب − المباشر',
    },
  };
}

module.exports = { audit, HttpError, deny, rolesIn, isAdmin, assertOrder, orderScope, match, orderKpis, split };
