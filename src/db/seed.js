// Demo data — ALL names, phones, documents and organisations are fictitious.
// Scenario: supply 100 electricians to King Fahd Stadium (Riyadh). 83 qualify -> gap 17.
const db = require('./index');
const { match } = require('../lib/core');

const FIRST = ['محمد', 'أحمد', 'خالد', 'سامي', 'راشد', 'يوسف', 'عمر', 'إبراهيم', 'حسن', 'طارق', 'Imran', 'Ramesh', 'Joseph', 'Arjun', 'Bilal', 'Kamal', 'Faisal', 'Nabil', 'Hany', 'Salem'];
const LAST = ['عبدالرحمن', 'الحربي', 'العتيبي', 'سيد', 'القحطاني', 'المصري', 'Khan', 'Kumar', 'Mathew', 'Nair', 'الشهري', 'الدوسري', 'Hussain', 'عبدالله', 'Ali'];
const SPECS = ['إنشاءات', 'صيانة', 'تمديدات'];
const SKILLS = ['لوحات توزيع', 'تمديدات جهد منخفض', 'قراءة مخططات', 'صيانة مولدات', 'إنارة'];
const ISSUES = ['unavailable', 'doc_expired', 'needs_permit', 'cv_incomplete', 'location', 'late_start'];

const MARKET_SA = {
  languages: ['ar', 'en'], defaultLanguage: 'ar', cities: ['الرياض', 'جدة', 'الدمام', 'الخرج', 'مكة', 'المدينة'],
  timezone: 'Asia/Riyadh', currency: 'SAR', phone: { countryCode: '966', pattern: '^5\\d{8}$', example: '+966 5X XXX XXXX' },
  documentTypes: ['iqama', 'work_permit', 'ajeer_contract', 'certificate'], workEligibility: ['eligible', 'needs_permit', 'unknown'],
  retentionMonths: 24, channels: ['whatsapp', 'sms', 'email', 'telegram'], fees: { enabled: false }, ageField: { enabled: false, note: 'يُفعّل فقط بحاجة تشغيلية معتمدة' }, launched: true,
};

async function ins(sql, params) { return db.one(`${sql} RETURNING *`, params); }

async function seed() {
  await ins('INSERT INTO markets (code, name, config) VALUES ($1,$2,$3)', ['SA', 'السعودية', JSON.stringify(MARKET_SA)]);
  for (const [code, name, tz, cur, cc] of [['EG', 'مصر', 'Africa/Cairo', 'EGP', '20'], ['AE', 'الإمارات', 'Asia/Dubai', 'AED', '971'], ['KE', 'كينيا', 'Africa/Nairobi', 'KES', '254']]) {
    await ins('INSERT INTO markets (code, name, config) VALUES ($1,$2,$3)', [code, name, JSON.stringify({ ...MARKET_SA, cities: [], timezone: tz, currency: cur, phone: { countryCode: cc }, launched: false })]);
  }
  const org = async (name, type, v) => ins('INSERT INTO orgs (name, type, verification, market_code) VALUES ($1,$2,$3,$4)', [name, type, v, 'SA']);
  const platform = await org('إدارة وصلة عمل', 'platform', 'manual_verified');
  const big = await org('شركة المشاريع الكبرى (تجريبية)', 'company_large', 'manual_verified');
  const supplier = await org('مؤسسة الكوادر المتحدة (تجريبية)', 'supplier', 'pending');
  const small = await org('ورشة النور الكهربائية (تجريبية)', 'company_small', 'pending');
  const other = await org('شركة أخرى للمقاولات (تجريبية)', 'company_large', 'manual_verified');

  const user = async (name, kind, phone, email) => ins('INSERT INTO users (name, phone, email, kind) VALUES ($1,$2,$3,$4)', [name, phone, email, kind]);
  const member = (u, o, role) => db.query('INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,$3)', [u.id, o.id, role]);
  const seeker = await user('محمد عبدالرحمن (باحث)', 'seeker', '+966500001000', 'seeker@example.com');
  const creator = await user('سارة — منشئة الطلب', 'member', '+966500002001', 'creator@example.com');
  const tech = await user('خالد — مراجع فني', 'member', '+966500002002', 'tech@example.com');
  const approver = await user('فهد — المعتمد النهائي', 'member', '+966500002003', 'approver@example.com');
  const agent = await user('يوسف — مسؤول المورد', 'member', '+966500003001', 'supplier@example.com');
  const smallAdmin = await user('نورة — مسؤولة الورشة', 'member', '+966500004001', 'small@example.com');
  const admin = await user('مدير المنصة', 'platform_admin', '+966500009001', 'admin@example.com');
  const otherApprover = await user('عمر — شركة أخرى', 'member', '+966500005001', 'other@example.com');
  await member(creator, big, 'creator');
  await member(tech, big, 'tech_reviewer');
  await member(tech, big, 'doc_reviewer');
  await member(approver, big, 'approver');
  await member(agent, supplier, 'supplier_agent');
  await member(agent, supplier, 'doc_reviewer');
  await member(smallAdmin, small, 'single_admin');
  await member(admin, platform, 'single_admin');
  await member(otherApprover, other, 'approver');

  const order = await ins(`INSERT INTO orders (code, org_id, kind, title, profession, specialties, quantity, city, site, duration, shifts, start_date, required_certs, required_skills, requires_work_permit, status, created_by, approved_by, assigned_supplier_org_id)
    VALUES ($1,$2,'supply',$3,'كهربائي',$4,100,'الرياض',$5,'6 أشهر','صباحية ومسائية',$6,'شهادة سلامة',$7,true,'assigned',$8,$9,$10)`,
  ['ORD-2026-0100', big.id, 'توريد 100 كهربائي — مشروع استاد الملك فهد', 'إنشاءات,صيانة,تمديدات', 'استاد الملك فهد الدولي', '2026-12-15', 'لوحات توزيع,تمديدات جهد منخفض,قراءة مخططات', creator.id, approver.id, supplier.id]);
  await ins(`INSERT INTO orders (code, org_id, kind, title, profession, quantity, city, duration, status, created_by, approved_by, requires_work_permit) VALUES ('ORD-2026-0101',$1,'direct','كهربائي لوحات تحكم','كهربائي',1,'الخرج','دوام كامل','approved',$2,$2,true)`, [small.id, smallAdmin.id]);
  await ins(`INSERT INTO orders (code, org_id, kind, title, profession, quantity, city, duration, status, created_by, approved_by) VALUES ('ORD-2026-0102',$1,'supply','توريد 20 سباك تمديدات','سباك',20,'الدمام','3 أشهر','approved',$2,$2)`, [other.id, otherApprover.id]);
  await ins(`INSERT INTO orders (code, org_id, kind, title, profession, quantity, city, duration, status, created_by) VALUES ('ORD-2026-0103',$1,'supply','توريد 15 فني صيانة تكييف','فني تكييف',15,'الرياض','4 أشهر','draft',$2)`, [big.id, creator.id]);

  const cand = async (i, over = {}) => {
    const c = {
      code: `W-${1001 + i}`, supplier_org_id: supplier.id, full_name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      phone: `+9665${String(10000000 + i * 137).padStart(8, '0')}`, email: `cand${1001 + i}@example.com`, profession: 'كهربائي', specialty: SPECS[i % 3],
      skills: [SKILLS[i % 5], SKILLS[(i + 1) % 5], SKILLS[(i + 2) % 5]].join(','), certs: 'شهادة سلامة', years_exp: 2 + (i % 12),
      city: i % 10 === 5 ? 'الخرج' : 'الرياض', accepted_cities: 'الرياض', accepts_relocation: false, available_from: '2026-12-01', available: true,
      verification: 'manual_verified', work_eligibility: 'eligible', cv_complete: true, user_id: null, ...over,
    };
    return ins(`INSERT INTO candidates (code, user_id, supplier_org_id, full_name, phone, email, profession, specialty, skills, certs, years_exp, city, accepted_cities, accepts_relocation, available_from, available, verification, work_eligibility, cv_complete)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [c.code, c.user_id, c.supplier_org_id, c.full_name, c.phone, c.email, c.profession, c.specialty, c.skills, c.certs, c.years_exp, c.city, c.accepted_cities, c.accepts_relocation, c.available_from, c.available, c.verification, c.work_eligibility, c.cv_complete]);
  };
  const issueOver = (kind) => ({ unavailable: { available: false }, doc_expired: { verification: 'doc_expired' }, needs_permit: { work_eligibility: 'needs_permit', verification: 'unverified' }, cv_incomplete: { cv_complete: false, certs: null, years_exp: null }, location: { city: 'جدة', accepted_cities: 'جدة', accepts_relocation: false }, late_start: { available_from: '2027-01-20' } }[kind]);

  const noms = [];
  for (let i = 0; i < 95; i++) {
    const good = i < 83;
    const c = await cand(i, i === 0 ? { user_id: seeker.id, full_name: 'محمد عبدالرحمن', phone: '+966500001000', email: 'seeker@example.com' } : good ? {} : issueOver(ISSUES[(i - 83) % ISSUES.length]));
    const m = match(c, order);
    const n = await ins(`INSERT INTO nominations (order_id, candidate_id, nominated_by_org_id, score, reasons, review_reasons, qualified, confirmed, contact_note, interviewed_at, tech_review, approval, started_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [order.id, c.id, supplier.id, m.score, JSON.stringify(m.reasons), JSON.stringify(m.reviewReasons), m.qualified,
      m.qualified && i < 71, m.qualified && i < 71 ? 'أكد التوفر هاتفيًا' : null, m.qualified && i < 60 ? '2026-11-24T10:00:00Z' : null,
      m.qualified && i < 60 ? 'passed' : 'none', m.qualified && i < 52 ? 'primary' : m.qualified && i < 60 ? 'backup' : 'none', m.qualified && i < 38 ? '2026-11-25T07:00:00Z' : null]);
    noms.push(n);
    await db.query('INSERT INTO consents (candidate_id, recipient_org_id, scope) VALUES ($1,$2,$3)', [c.id, big.id, 'share_profile']);
    if (good) {
      if (i < 61) await db.query('INSERT INTO consents (candidate_id, recipient_org_id, scope) VALUES ($1,$2,$3)', [c.id, big.id, 'share_contact']);
      for (const [scope, lim] of [['channel_whatsapp', 75], ['channel_sms', 83], ['channel_email', 50], ['channel_telegram', 12]]) if (i < lim) await db.query('INSERT INTO consents (candidate_id, scope) VALUES ($1,$2)', [c.id, scope]);
    }
    if (!good && ISSUES[(i - 83) % ISSUES.length] === 'doc_expired') await db.query('INSERT INTO review_tasks (candidate_id, reason, action_for_candidate) VALUES ($1,$2,$3)', [c.id, 'إقامة منتهية الصلاحية', 'ارفع صورة إقامة سارية']);
  }
  // A replacement: W-0991 did not start, replaced by the candidate at index 37.
  const old = await cand(-10, { code: 'W-0991', full_name: 'Bilal Hussain' });
  const oldNom = await ins(`INSERT INTO nominations (order_id, candidate_id, nominated_by_org_id, score, reasons, review_reasons, qualified, confirmed, tech_review, approval, replaced_at, replace_reason, replaced_by_nomination_id)
    VALUES ($1,$2,$3,80,'[]','[]',true,true,'passed','primary','2026-11-20T09:00:00Z','لم يباشر في الموعد',$4)`, [order.id, old.id, supplier.id, noms[37].id]);
  await db.query('UPDATE nominations SET replaces_nomination_id = $1 WHERE id = $2', [oldNom.id, noms[37].id]);
  // Supplier pool not yet nominated (for adding / replacement demos); W-1110 shares a phone with W-1050 (duplicate).
  for (let i = 100; i < 110; i++) await cand(i, i === 109 ? { phone: '+966510006713', full_name: 'Kamal Nair' } : {});
  await db.query("UPDATE candidates SET phone = '+966510006713' WHERE code = 'W-1050'");

  // Seeker's extracted CV fields (fictitious) for the review screen.
  const sk = await db.one("SELECT id FROM candidates WHERE code = 'W-1001'");
  for (const [field, value, src, conf, st] of [['full_name', 'محمد عبدالرحمن', 'line:1', 0.98, 'confirmed'], ['phone', '+966500001000', 'line:2', 0.92, 'pending'], ['email', 'seeker@example.com', 'line:2', 0.97, 'pending'], ['profession', 'كهربائي إنشاءات', 'line:4', 0.93, 'pending'], ['skills', 'لوحات توزيع، تمديدات جهد منخفض، قراءة مخططات', 'line:9', 0.86, 'pending'], ['experience_years', '8', 'line:12', 0.74, 'pending'], ['city', null, null, 0, 'missing'], ['availability', null, null, 0, 'missing']]) {
    await db.query('INSERT INTO cv_fields (candidate_id, field, value, source_ref, confidence, review_state) VALUES ($1,$2,$3,$4,$5,$6)', [sk.id, field, value, src, conf, st]);
  }
  await db.query("INSERT INTO settings (key, value) VALUES ('support', $1)", [JSON.stringify({ phone: '[رقم الدعم]', whatsapp: '[رقم واتساب الأعمال]', email: '[support@your-domain]', hours: '[الأحد–الخميس 8ص–5م]', note: 'عدّل هذه البيانات من لوحة الإدارة' })]);
  await db.query("INSERT INTO audit_log (user_id, org_id, action, entity, entity_id, details) VALUES ($1,$2,'order_approve','order',$3,'{}')", [approver.id, big.id, String(order.id)]);
  await db.query("INSERT INTO audit_log (user_id, org_id, action, entity, entity_id, details) VALUES ($1,$2,'order_assign','order',$3,$4)", [approver.id, big.id, String(order.id), JSON.stringify({ supplier: supplier.id })]);
  return { orderId: order.id };
}

module.exports = { seed };

if (require.main === module) {
  (async () => { await db.migrate(); await seed(); console.log('seeded'); process.exit(0); })().catch((e) => { console.error(e); process.exit(1); });
}
