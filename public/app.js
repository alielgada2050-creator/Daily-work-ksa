// [UI-*] Wasla Amal PWA — vanilla JS, no inline handlers (CSP: script-src 'self').
'use strict';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '—');
const S = { me: null, view: 'home', orderId: null, q: '', kind: '', filters: {}, list: '', page: 1, batch: null, msg: { channel: 'whatsapp', template: 'invite', key: null }, order: null };

async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', headers: {}, ...opts };
  if (opts.json) { init.method = init.method || 'POST'; init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(opts.json); }
  const r = await fetch(`/api${path}`, init);
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error((data && data.message) || `خطأ ${r.status}`);
  return data;
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4500); }
function ask(label) {
  return new Promise((res) => {
    const d = $('#ask'); $('#ask-label').textContent = label; $('#ask-input').value = '';
    d.onclose = () => res(d.returnValue === 'ok' ? $('#ask-input').value.trim() : null);
    d.showModal();
  });
}
const roles = () => new Set((S.me?.memberships || []).map((m) => m.role));
const isAdmin = () => S.me?.kind === 'platform_admin';

// ---------------- navigation ----------------
function navItems() {
  const items = [['home', 'الوظائف والطلبات']];
  if (!S.me) items.push(['login', 'تسجيل الدخول']);
  if (S.me && (S.me.memberships.length || isAdmin())) items.push(['orders', 'طلباتي ولوحة الطلب'], ['messages', 'التواصل والإشعارات']);
  if (S.me && S.me.kind === 'seeker') items.push(['me', 'ملفي']);
  if (isAdmin()) items.push(['admin', 'إدارة المنصة']);
  items.push(['support', 'الدعم الفني'], ['settings', 'الإعدادات والسوق']);
  return items;
}
function renderNav() {
  $('#nav').innerHTML = navItems().map(([id, l]) => `<button data-action="go" data-view="${id}" ${S.view === id ? 'aria-current="page"' : ''}>${esc(l)}</button>`).join('')
    + '<p class="demo-note">وضع تجريبي: البيانات مصطنعة والقنوات محاكاة حتى تُربط الخدمات الفعلية.</p>';
  $('#who').textContent = S.me ? `${S.me.name}` : '';
  $('#logout-btn').hidden = !S.me;
}
async function go(view, extra = {}) { Object.assign(S, { view }, extra); renderNav(); await render(); $('#main').focus({ preventScroll: true }); }

async function render() {
  const m = $('#main');
  try { m.innerHTML = await (VIEWS[S.view] || VIEWS.home)(); } catch (e) { m.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
}

// ---------------- views ----------------
const VIEWS = {
  // [UI-HOME]
  async home() {
    const qs = new URLSearchParams({ q: S.q, kind: S.kind }).toString();
    const r = await api(`/jobs?${qs}`);
    const pill = (k, l) => `<button class="${S.kind === k ? 'btn' : 'btn2'} sm" data-action="kind" data-kind="${k}">${l}</button>`;
    return `<section class="card hero"><h1 class="h1">اربط الكفاءة بالفرصة، بلا وسيط غامض</h1>
      <p>الوظائف وطلبات التوريد منشورة للعموم، وبيانات المرشحين خاصة لا تُشارك إلا بموافقتهم ولجهة محددة.</p>
      <div class="row">${S.me ? '' : '<button class="btn" data-action="go" data-view="login">ابدأ الآن</button>'}<button class="btn2" data-action="go" data-view="support">تواصل مع الدعم</button></div></section>
      <div class="row">${pill('', 'الكل')}${pill('supply', 'طلبات توريد')}${pill('direct', 'توظيف مباشر')}</div>
      <div class="grid">${r.items.map((j) => `<article class="card"><div class="row between"><span class="tag">${j.kind === 'supply' ? 'توريد كوادر' : 'توظيف مباشر'}</span><span class="muted">${esc(j.code)}</span></div>
        <h3>${esc(j.title)}</h3><div class="muted">${esc(j.org_name)} · ${esc(j.city)} ${j.org_verification === 'manual_verified' ? '<span class="tag ok">منشأة متحقق منها يدويًا</span>' : ''}</div>
        <div>${esc(j.quantity)} · ${esc(j.duration || '')} ${j.start_date ? `· المباشرة ${day(j.start_date)}` : ''}</div>
        <button class="btn2" data-action="apply">التقديم عبر ملفي</button></article>`).join('') || '<div class="card empty">لا نتائج لهذا البحث.</div>'}</div>`;
  },

  // [UI-LOGIN]
  async login() {
    const r = await api('/auth/demo-users');
    return `<div class="grid"><section class="card"><h2>الدخول بالجوال أو البريد</h2>
      <form data-form="otp-request" class="field"><label for="dest">رقم الجوال أو البريد</label><input id="dest" name="destination" required placeholder="05XXXXXXXX أو name@example.com"><button class="btn">إرسال رمز التحقق</button></form>
      <form data-form="otp-verify" class="field"><label for="code">رمز التحقق</label><input id="code" name="code" inputmode="numeric" required><button class="btn2">تحقق ودخول</button></form>
      <p class="muted">مزود الرسائل حاليًا محاكاة؛ يظهر الرمز في رسالة التنبيه في وضع التطوير فقط.</p></section>
      ${r.users.length ? `<section class="card"><h2>حسابات تجريبية</h2><p class="muted">جرّب كل دور في مسار طلب الـ100 كهربائي.</p>
      ${r.users.map((u) => `<div class="item"><div><b>${esc(u.name)}</b><div class="muted">${esc(u.org_name || (u.kind === 'seeker' ? 'باحث عن عمل' : ''))} ${u.role ? `· ${esc(ROLE[u.role] || u.role)}` : ''}</div></div><button class="btn2 sm" data-action="demo-login" data-id="${u.id}">دخول</button></div>`).join('')}</section>` : ''}</div>`;
  },

  // [UI-COMPANY-ORDER] [UI-SUPPLIER-PORTAL]
  async orders() {
    if (!S.orderId) {
      const r = await api('/orders');
      return `<div class="row between"><h2>الطلبات</h2>${roles().has('creator') || roles().has('single_admin') || roles().has('approver') ? '<button class="btn" data-action="new-order">طلب جديد</button>' : ''}</div>
        <div id="new-order"></div>
        <div class="grid">${r.items.map((o) => `<article class="card"><div class="row between"><span class="tag ${o.status === 'draft' ? 'warn' : 'ok'}">${STATUS[o.status]}</span><span class="muted">${esc(o.code)}</span></div>
        <h3>${esc(o.title)}</h3><div class="muted">${esc(o.org_name)} · ${esc(o.city)} · ${esc(o.quantity)}</div>
        <button class="btn2" data-action="open-order" data-id="${o.id}">فتح لوحة الطلب</button></article>`).join('') || '<div class="card empty">لا توجد طلبات لمؤسستك بعد.</div>'}</div>`;
    }
    const d = await api(`/orders/${S.orderId}`);
    S.order = d;
    const o = d.order; const k = d.kpis; const own = new Set(d.scope.owner); const sup = new Set(d.scope.supplier);
    const can = {
      approveOrder: own.has('approver') || own.has('single_admin'), assign: own.has('approver') || own.has('single_admin') || own.has('creator'),
      tech: own.has('tech_reviewer') || own.has('approver') || own.has('single_admin'), final: own.has('approver') || own.has('single_admin'),
      contact: sup.has('supplier_agent') || own.has('creator') || own.has('approver') || own.has('single_admin'), progress: own.size > 0,
      nominate: sup.has('supplier_agent') || own.has('creator') || own.has('single_admin'), exportContact: own.has('approver') || own.has('single_admin'), supplier: sup.has('supplier_agent'),
    };
    const qs = new URLSearchParams({ ...S.filters, list: S.list, page: S.page, pageSize: 25 }).toString();
    const n = await api(`/orders/${o.id}/nominations?${qs}`);
    const K = (key, label, cls = '') => `<div class="kpi ${cls}"><span>${label}</span><b>${k[key]}</b><span>${esc(k.definitions[key])}</span></div>`;
    const f = S.filters;
    const sel = (name, opts, label) => `<label class="sr" for="f-${name}">${label}</label><select id="f-${name}" data-filter="${name}"><option value="">${label}: الكل</option>${opts.map(([v, l]) => `<option value="${v}" ${f[name] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    const pages = Math.max(1, Math.ceil(n.total / n.pageSize));
    return `<div class="row between"><div><button class="ghost sm" data-action="back-orders">→ كل الطلبات</button>
      <div class="muted">${esc(o.code)} · ${STATUS[o.status]} · ${o.kind === 'supply' ? 'توريد كوادر' : 'توظيف مباشر'}</div>
      <h2>${esc(o.title)}</h2><div class="muted">${esc(o.city)} · ${esc(o.site || '')} · ${esc(o.duration || '')} · ${esc(o.shifts || '')} · المباشرة ${day(o.start_date)}</div></div>
      <div class="row">${o.status === 'draft' ? `<button class="btn" data-action="approve-order" ${can.approveOrder ? '' : 'disabled title="يتطلب دور المعتمد"'}>اعتماد الطلب</button>${can.approveOrder ? '' : '<span class="muted">الاعتماد للمعتمد النهائي</span>'}` : ''}
      ${o.status === 'approved' && can.assign ? '<button class="btn" data-action="assign">إسناد لمورد</button>' : ''}
      <a class="btn2" href="/api/orders/${o.id}/export.xlsx">تصدير XLSX (عربي)</a>
      <a class="btn2" href="/api/orders/${o.id}/export.xlsx?lang=en">XLSX (English)</a>
      ${can.exportContact ? `<a class="btn2" href="/api/orders/${o.id}/export.xlsx?contact=1">مع الاسم والجوال (بالموافقة)</a>` : ''}
      <a class="btn2" href="/api/orders/${o.id}/export.xlsx?list=backup">تصدير الاحتياطي</a>
      <button class="btn" data-action="go" data-view="messages">مراسلة المرشحين</button></div></div>
      <div class="kpis">${K('required', 'المطلوب')}${K('qualified', 'المؤهل')}${K('gap', 'العجز', 'gap')}${K('confirmed', 'المؤكد')}${K('approved', 'المعتمد')}${K('backup', 'الاحتياطي')}${K('started', 'المباشر')}${K('remaining', 'المتبقي للمباشرة')}</div>
      ${can.supplier ? await uploadCard(o) : ''}
      <section class="card"><div class="row between"><h3>المرشحون (${n.total})</h3>
        <div class="row">${['', 'primary', 'backup', 'review'].map((l) => `<button class="${S.list === l ? 'btn' : 'btn2'} sm" data-action="list" data-list="${l}">${{ '': 'الكل', primary: 'القائمة الأساسية', backup: 'الاحتياطية', review: 'تحتاج مراجعة' }[l]}</button>`).join('')}</div></div>
        <div class="row">${sel('specialty', [['إنشاءات', 'إنشاءات'], ['صيانة', 'صيانة'], ['تمديدات', 'تمديدات']], 'التخصص')}${sel('city', [['الرياض', 'الرياض'], ['الخرج', 'الخرج'], ['جدة', 'جدة']], 'المدينة')}
        ${sel('verification', [['manual_verified', 'تم التحقق يدويًا'], ['unverified', 'غير متحقق'], ['doc_expired', 'وثيقة منتهية']], 'التحقق')}${sel('available', [['true', 'المتاحون فقط']], 'التوفر')}
        ${sel('minExp', [['3', '3+ سنوات'], ['5', '5+ سنوات'], ['8', '8+ سنوات']], 'الخبرة')}<input data-filter="skill" placeholder="مهارة…" value="${esc(f.skill || '')}" aria-label="تصفية بالمهارة"></div>
        <div class="table-wrap"><table><thead><tr><th>المرشح</th><th>التخصص والخبرة</th><th>الموقع والتوفر</th><th>التحقق</th><th>المطابقة وأسبابها</th><th>المرحلة</th><th>إجراءات</th></tr></thead><tbody>
        ${n.items.map((c) => row(c, can)).join('') || '<tr><td colspan="7" class="empty">لا مرشحين بهذه التصفية.</td></tr>'}</tbody></table></div>
        <div class="row between"><span class="muted">صفحة ${n.page} من ${pages}</span><div class="row"><button class="btn2 sm" data-action="page" data-d="-1" ${n.page <= 1 ? 'disabled' : ''}>السابق</button><button class="btn2 sm" data-action="page" data-d="1" ${n.page >= pages ? 'disabled' : ''}>التالي</button></div></div></section>
      ${can.nominate ? `<section class="card"><h3>إضافة مرشح للطلب</h3><form data-form="nominate" class="row"><label for="cc" class="sr">معرّف المرشح</label><input id="cc" name="code" placeholder="مثال: W-1101" required><button class="btn">إضافة</button></form><p class="muted">يمنع النظام إضافة الشخص نفسه مرتين للطلب.</p></section>` : ''}`;
  },

  // [UI-SEEKER-PROFILE]
  async me() {
    const p = await api('/me/profile');
    const FL = { full_name: 'الاسم', phone: 'الجوال', email: 'البريد', profession: 'المهنة', skills: 'المهارات', experience_years: 'سنوات الخبرة', certs: 'الشهادات', city: 'المدينة', availability: 'التوفر', birth_date: 'تاريخ الميلاد', specialty: 'التخصص' };
    const consentOn = (scope) => p.consents.find((c) => c.scope === scope && !c.withdrawn_at);
    const SC = [['share_profile', 'مشاركة ملفي مع الجهة عند الترشيح'], ['share_contact', 'مشاركة اسمي وجوالي مع الجهة المرشَّح لها'], ['channel_whatsapp', 'تنبيهات واتساب'], ['channel_sms', 'رسائل SMS'], ['channel_email', 'البريد'], ['channel_telegram', 'تيليجرام (بعد بدء المحادثة مع البوت)'], ['marketing', 'رسائل اختيارية وعروض']];
    return `<h2>ملفي — ${esc(p.candidate.code)}</h2>
      ${p.tasks.map((t) => `<div class="card alert"><b>مطلوب منك:</b> ${esc(t.action_for_candidate)} <span class="muted">(${esc(t.reason)})</span></div>`).join('')}
      <div class="grid"><section class="card"><h3>السيرة الذاتية</h3><form data-form="cv" class="row"><label for="cvf" class="sr">ملف السيرة</label><input id="cvf" type="file" name="file" accept=".pdf,.docx" required><button class="btn">رفع وتحليل</button></form>
        <p class="muted">PDF أو DOCX حتى 10MB. بعد التحليل راجع الحقول وصحّحها؛ البيانات المصححة هي التي تُستخدم في الترشيح.</p>
        ${p.fields.map((f) => `<div class="item"><div><div class="muted">${esc(FL[f.field] || f.field)} · ثقة ${Math.round((f.confidence || 0) * 100)}% · ${esc(f.source_ref || 'غير متوفر في السيرة')} · <span class="tag ${f.review_state === 'missing' ? 'warn' : f.review_state === 'corrected' ? 'ok' : ''}">${REVIEW[f.review_state]}</span></div><div>${esc(f.value ?? 'غير متوفر')}</div></div>
        <button class="btn2 sm" data-action="fix-field" data-id="${f.id}" data-label="${esc(FL[f.field] || f.field)}">${f.value ? 'تصحيح' : 'إدخال'}</button></div>`).join('') || '<div class="empty">ارفع سيرتك لاستخراج الحقول.</div>'}</section>
      <div class="stack"><section class="card"><h3>المهن والمدن والتوفر</h3>
        <form data-form="profile" class="field"><label for="pf">المهنة</label><input id="pf" name="profession" value="${esc(p.candidate.profession || '')}">
        <label for="pc">المدن التي أقبل العمل فيها (افصل بفاصلة)</label><input id="pc" name="acceptedCities" value="${esc(p.candidate.accepted_cities || '')}">
        <label class="row"><input class="chk" type="checkbox" name="acceptsRelocation" ${p.candidate.accepts_relocation ? 'checked' : ''}>أقبل الانتقال لموقع المشروع</label>
        <label for="pa">متاح من تاريخ</label><input id="pa" type="date" name="availableFrom" value="${p.candidate.available_from ? day(p.candidate.available_from) : ''}"><button class="btn2">حفظ</button></form></section>
      <section class="card"><h3>الوثائق</h3>${p.documents.map((d) => `<div class="item"><div>${esc(DOC[d.kind] || d.kind)} · ${esc(d.filename)}</div><span class="tag ${d.status === 'expired' ? 'bad' : d.status === 'verified_manual' ? 'ok' : ''}">${DSTATUS[d.status] || d.status}</span></div>`).join('')}
        <form data-form="doc" class="field"><label for="dk">نوع الوثيقة</label><select id="dk" name="kind"><option value="iqama">صورة الإقامة</option><option value="work_permit">تصريح العمل</option><option value="ajeer_contract">عقد أجير</option><option value="certificate">شهادة</option></select>
        <label for="de">تاريخ الانتهاء (إن وجد)</label><input id="de" type="date" name="expiresOn"><label for="df" class="sr">الملف</label><input id="df" type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required><button class="btn2">رفع الوثيقة</button></form>
        <p class="muted">تُطلب الإقامة أو تصريح العمل عند مرحلة تحقق يستدعيها الطلب. تُحفظ الوثائق بشكل خاص ولا تخرج في التصدير.</p></section>
      <section class="card"><h3>الموافقات وقنوات التواصل</h3>${SC.map(([s, l]) => { const c = consentOn(s); return `<div class="item"><div>${l}${c && c.recipient_name ? `<div class="muted">الجهة: ${esc(c.recipient_name)}</div>` : ''}</div>${c ? `<button class="btn2 sm" data-action="withdraw" data-id="${c.id}">سحب الموافقة</button>` : `<button class="btn2 sm" data-action="grant" data-scope="${s}">موافقة</button>`}</div>`; }).join('')}
        <p class="muted">السحب يوقف المشاركات والرسائل المستقبلية؛ ما شورك سابقًا يبقى موثقًا في سجل التدقيق.</p></section>
      <section class="card"><h3>ترشيحاتي</h3>${p.nominations.map((n) => `<div class="item"><div>${esc(n.title)} · ${esc(n.city)}<div class="muted">${esc(n.org_name)} · ${esc(n.code)}</div></div><span class="tag ${n.approval === 'primary' ? 'ok' : ''}">${n.started_at ? 'باشر' : APPROVAL[n.approval]}</span></div>`).join('') || '<div class="empty">لا ترشيحات بعد.</div>'}</section></div></div>`;
  },

  // [UI-MESSAGES]
  async messages() {
    const orders = (await api('/orders')).items;
    if (!S.orderId && orders[0]) S.orderId = orders[0].id;
    if (!S.orderId) return '<div class="card empty">لا يوجد طلب لمراسلة مرشحيه.</div>';
    const pv = await api(`/orders/${S.orderId}/messages/preview?channel=${S.msg.channel}&template=${S.msg.template}`).catch((e) => ({ error: e.message }));
    if (!S.msg.key) S.msg.key = crypto.randomUUID();
    const CH = [['whatsapp', 'واتساب', 'تكامل أعمال رسمي؛ عند غيابه رابط محادثة يدوية للمخوّل'], ['sms', 'SMS', 'مزود يدعم السوق المطلوب'], ['email', 'البريد', 'مزود إرسال أو Gmail عبر OAuth'], ['telegram', 'تيليجرام', 'بوت للمشتركين الذين بدأوا المحادثة']];
    const TP = [['invite', 'دعوة المرشح'], ['availability', 'تأكيد التوفر'], ['interview', 'تحديد المقابلة'], ['missing_doc', 'تنبيه نقص المستند'], ['start_confirm', 'تأكيد المباشرة']];
    const prov = (await api('/providers')).providers;
    const hist = await api(`/orders/${S.orderId}/messages`).catch(() => ({ items: [] }));
    return `<h2>التواصل والإشعارات</h2>
      <div class="field"><label for="mo">الطلب</label><select id="mo" data-msg="order">${orders.map((o) => `<option value="${o.id}" ${o.id === S.orderId ? 'selected' : ''}>${esc(o.code)} — ${esc(o.title)}</option>`).join('')}</select></div>
      <div class="grid">${CH.map(([id, l, dsc]) => `<button class="card choice ${S.msg.channel === id ? 'selected' : ''}" data-action="channel" data-ch="${id}"><b>${l}</b><span class="muted">${dsc}</span><span class="tag ${prov[id] === 'mock' ? 'warn' : 'ok'}">${prov[id] === 'mock' ? 'محاكاة' : 'تكامل فعلي'}</span></button>`).join('')}</div>
      <section class="card"><div class="field"><label for="tp">القالب</label><select id="tp" data-msg="template">${TP.map(([v, l]) => `<option value="${v}" ${S.msg.template === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      ${pv.error ? `<p>${esc(pv.error)}</p>` : `<div class="preview">${esc(pv.sample)}</div>
      <div class="row between"><span>المستلمون المصرّح بهم: <b>${pv.recipients}</b>${pv.withoutConsent > 0 ? ` <span class="muted">(${pv.withoutConsent} من المؤهلين بلا موافقة على هذه القناة)</span>` : ''}</span>
      <div class="row">${pv.manualLink ? `<a class="btn2" target="_blank" rel="noopener" href="${esc(pv.manualLink)}">محادثة واتساب يدوية</a>` : ''}<button class="btn" data-action="send" ${pv.recipients ? '' : 'disabled title="لا مستلمين بموافقة"'}>إرسال جماعي</button></div></div>
      <p class="muted">مفتاح الدفعة ${esc(S.msg.key.slice(0, 8))}… — إعادة الضغط لا تكرر الإرسال. «أُرسل» و«تم التسليم» تظهران فقط عند تأكيد المزود الفعلي.</p>`}</section>
      <section class="card"><div class="row between"><h3>سجل الإرسال</h3><button class="btn2 sm" data-action="refresh">تحديث الحالات</button></div>
      ${hist.items.map((m) => `<div class="item"><div>${esc(CHN[m.channel] || m.channel)} · ${esc(TPN[m.template] || m.template)} · ${esc(new Date(m.created_at).toLocaleString('ar-SA'))}<div class="muted">${m.recipient_count} مستلمًا · ${esc(MST[m.status] || m.status)}</div></div>
        <div class="row">${Object.entries(m.counts).map(([k, v]) => `<span class="tag ${k === 'failed' ? 'bad' : ['delivered', 'read'].includes(k) ? 'ok' : k === 'simulated' ? 'warn' : ''}">${esc(DST[k] || k)}: ${v}</span>`).join('')}</div></div>`).join('') || '<div class="empty">لا رسائل بعد.</div>'}</section>`;
  },

  // [UI-ADMIN]
  async admin() {
    const [orgs, audit, dups, tickets] = await Promise.all([api('/admin/orgs'), api('/admin/audit?limit=40'), api('/admin/duplicates'), api('/admin/tickets')]);
    return `<h2>إدارة المنصة</h2><div class="grid">
      <section class="card"><h3>تحقق المنشآت والموردين</h3>${orgs.items.map((o) => `<div class="item"><div>${esc(o.name)}<div class="muted">${esc(ORGT[o.type] || o.type)} · ${esc(VER[o.verification] || o.verification)}</div></div>${o.verification === 'pending' ? `<button class="btn2 sm" data-action="verify-org" data-id="${o.id}">تحقق يدوي</button>` : ''}</div>`).join('')}</section>
      <section class="card"><h3>التكرار</h3>${dups.samePhone.map((g) => `<div class="item"><div>${g.map((c) => esc(c.code)).join(' و ')}<div class="muted">نفس الجوال — راجع قبل الدمج</div></div></div>`).join('') || '<div class="empty">لا تكرار</div>'}
        ${dups.importHeld.map((j) => `<div class="item"><div>${esc(j.filename)}<div class="muted">محجوز عند الاستيراد: يطابق ${esc(j.code)}</div></div></div>`).join('')}</section>
      <section class="card"><h3>البلاغات</h3>${tickets.items.map((t) => `<div class="item"><div>${esc(t.code)} · ${esc(t.body.slice(0, 80))}</div><span class="tag">${esc(t.status)}</span></div>`).join('') || '<div class="empty">لا بلاغات</div>'}</section>
      <section class="card"><h3>بيانات الدعم الفني</h3><form data-form="support-info" class="field">${['phone', 'whatsapp', 'email', 'hours'].map((k) => `<label for="si-${k}">${{ phone: 'الهاتف', whatsapp: 'واتساب', email: 'البريد', hours: 'ساعات العمل' }[k]}</label><input id="si-${k}" name="${k}">`).join('')}<button class="btn2">حفظ</button></form></section></div>
      <section class="card"><h3>سجل التدقيق</h3><div class="table-wrap"><table><thead><tr><th>الوقت</th><th>المستخدم</th><th>الإجراء</th><th>الكيان</th><th>تفاصيل</th></tr></thead><tbody>
      ${audit.items.map((a) => `<tr><td>${esc(new Date(a.at).toLocaleString('ar-SA'))}</td><td>${esc(a.user_name || '—')}</td><td>${esc(a.action)}</td><td>${esc(a.entity)} ${esc(a.entity_id || '')}</td><td class="why">${esc(a.details)}</td></tr>`).join('')}</tbody></table></div></section>`;
  },

  // [UI-SUPPORT]
  async support() {
    const info = await api('/support/info');
    const orders = S.me ? (await api('/orders').catch(() => ({ items: [] }))).items : [];
    return `<div class="grid"><section class="card"><h2>الدعم الفني</h2>
      <div>الهاتف: ${esc(info.phone)}</div><div>واتساب الأعمال: ${esc(info.whatsapp)}</div><div>البريد: ${esc(info.email)}</div><div>ساعات العمل: ${esc(info.hours)}</div><p class="muted">${esc(info.note || '')}</p></section>
      <section class="card"><h3>نموذج بلاغ</h3>${S.me ? `<form data-form="ticket" class="field"><label for="to">مرتبط بطلب (اختياري)</label><select id="to" name="orderId"><option value="">بدون طلب</option>${orders.map((o) => `<option value="${o.id}">${esc(o.code)} — ${esc(o.title)}</option>`).join('')}</select>
      <label for="tb">وصف المشكلة</label><textarea id="tb" name="body" rows="4" required></textarea><button class="btn">إرسال البلاغ</button></form>` : '<p>سجّل الدخول لإرسال بلاغ.</p><button class="btn2" data-action="go" data-view="login">تسجيل الدخول</button>'}</section></div>`;
  },

  // [UI-SETTINGS]
  async settings() {
    const [m, p] = await Promise.all([api('/markets'), api('/providers')]);
    const LBL = { languages: 'اللغات', cities: 'المدن', timezone: 'المنطقة الزمنية', currency: 'العملة', phone: 'تنسيق الهاتف', documentTypes: 'أنواع الوثائق', workEligibility: 'حالات أهلية العمل', retentionMonths: 'الاحتفاظ بالبيانات (شهر)', channels: 'قنوات الإرسال', launched: 'مُطلق' };
    const val = (v) => (Array.isArray(v) ? v.join('، ') : typeof v === 'object' ? Object.values(v).join(' · ') : String(v));
    return `<h2>الإعدادات والأسواق</h2><div class="grid">${m.items.map((mk) => `<section class="card"><h3>${esc(mk.name)} (${esc(mk.code)}) ${mk.config.launched ? '<span class="tag ok">مُطلق</span>' : '<span class="tag warn">قيد التجهيز</span>'}</h3>
      ${Object.entries(LBL).filter(([k]) => mk.config[k] !== undefined && k !== 'launched').map(([k, l]) => `<div class="item"><span class="muted">${l}</span><span>${esc(val(mk.config[k])) || '—'}</span></div>`).join('')}</section>`).join('')}
      <section class="card"><h3>حالة الخدمات</h3>${Object.entries(p.providers).map(([k, v]) => `<div class="item"><span>${esc(PROV[k] || k)}</span><span class="tag ${['mock', 'none', 'heuristic', 'local'].includes(v) ? 'warn' : 'ok'}">${esc(v)}</span></div>`).join('')}
      <p class="muted">لتفعيل خدمة فعلية عدّل متغيرات البيئة كما في README. تعديل إعدادات السوق متاح للإدارة عبر PUT /api/admin/markets/:code.</p></section>
      <section class="card"><h3>سلسلة الذكاء الاصطناعي لتحليل السير</h3><p class="muted">يُجرَّب المزودون بالترتيب، وعند أي فشل أو حد استخدام ينتقل للتالي، وآخرها الاستخراج المحلي. ${p.redactContact ? 'الجوال والبريد يُخفيان قبل الإرسال لأي مزود خارجي.' : 'تنبيه: إخفاء الجوال والبريد معطّل.'}</p>
      ${p.ai.map((x, i) => `<div class="item"><span>${i + 1}. ${esc(x.label)}</span><span class="tag ${x.configured ? 'ok' : 'warn'}">${x.configured ? 'مهيأ' : 'غير مهيأ — يُتخطى'}</span></div>`).join('')}
      ${isAdmin() ? '<div class="row"><button class="btn2" data-action="ai-test">اختبار السلسلة بسيرة وهمية</button></div><div id="ai-test-out" class="muted"></div>' : ''}</section></div>`;
  },
};

async function uploadCard(o) {
  let status = '';
  if (S.batch) {
    const b = await api(`/cv-batches/${S.batch}`);
    const pct = Math.round(((b.total - b.pending) / b.total) * 100);
    status = `<progress class="bar" max="100" value="${pct}" aria-label="تقدم المعالجة">${pct}%</progress><div class="muted">تمت معالجة ${b.total - b.pending} من ${b.total} · نجح ${b.done} · تعذّر ${b.failed} · مكرر محجوز ${b.duplicate}</div>
      ${b.jobs.map((j) => `<div class="item"><div>${esc(j.filename)}${j.error ? `<div class="muted">${esc(j.error)}</div>` : ''}</div><div class="row"><span class="tag ${j.status === 'done' ? 'ok' : j.status === 'failed' ? 'bad' : 'warn'}">${JOB[j.status]}</span>${j.status === 'failed' ? `<button class="btn2 sm" data-action="retry" data-id="${j.id}">إعادة المحاولة</button>` : ''}</div></div>`).join('')}`;
    if (b.pending) setTimeout(() => S.view === 'orders' && render(), 1200);
  }
  return `<section class="card"><h3>رفع السير على دفعة</h3><form data-form="batch" class="row"><label for="bf" class="sr">ملفات السير</label><input id="bf" type="file" name="files" multiple accept=".pdf,.docx" required><button class="btn">رفع ومعالجة</button></form>
    <p class="muted">PDF أو DOCX حتى 10MB للملف. يُفحص النوع على الخادم، ويُحجز التكرار للمراجعة قبل الدمج.</p>${status}</section>`;
}

function row(c, can) {
  const vt = { manual_verified: ['ok', 'تم التحقق يدويًا'], external_verified: ['ok', 'متحقق لدى جهة خارجية'], doc_expired: ['bad', 'وثيقة منتهية'], unverified: ['warn', 'غير متحقق'] }[c.verification] || ['', c.verification];
  const stage = c.replacedAt ? `مستبدَل: ${c.replaceReason}` : c.startedAt ? 'باشر' : c.approval !== 'none' ? APPROVAL[c.approval] : c.interviewedAt ? 'قوبل' : c.confirmed ? 'مؤكد التوفر' : c.qualified ? 'مؤهل' : 'يحتاج مراجعة';
  const b = (a, l, ok = true) => (ok ? `<button class="btn2 sm" data-action="${a}" data-id="${c.nominationId}">${l}</button>` : '');
  return `<tr><td><b>${esc(c.name || 'مخفي — لا موافقة')}</b><div class="muted">${esc(c.code)}${c.phone ? ` · ${esc(c.phone)}` : ''}</div>${c.replacesNominationId ? '<span class="tag">بديل</span>' : ''}</td>
    <td>${esc(c.specialty || '—')}<div class="muted">${c.yearsExp ?? '—'} سنوات</div></td>
    <td>${esc(c.city || '—')}<div class="muted">${c.available ? `متاح من ${day(c.availableFrom)}` : 'غير متاح'}</div></td>
    <td><span class="tag ${vt[0]}">${vt[1]}</span></td>
    <td><b>${c.score}%</b><div class="why">${esc(c.reasons.join(' · '))}</div>${c.reviewReasons.length ? `<div class="why bad">يحتاج مراجعة: ${esc(c.reviewReasons.join(' · '))}</div>` : ''}</td>
    <td>${esc(stage)}${c.contactNote ? `<div class="why">${esc(c.contactNote)}</div>` : ''}${c.techReview !== 'none' ? `<div class="why">المراجع الفني: ${c.techReview === 'passed' ? 'اجتاز' : 'أعاده'}</div>` : ''}</td>
    <td><div class="row">${c.replacedAt ? '' : [b('contact', 'توثيق التواصل', can.contact), b('tech-pass', 'اجتاز فنيًا', can.tech && c.techReview !== 'passed'), b('primary', 'أساسي', can.final && c.qualified && c.approval !== 'primary'),
      b('backup', 'احتياطي', can.final && c.qualified && c.approval !== 'backup' && !c.startedAt), b('return', 'إرجاع بسبب', can.final || can.tech), b('interview', 'مقابلة', can.progress && !c.interviewedAt), b('start', 'باشر', can.progress && c.approval === 'primary' && !c.startedAt), b('replace', 'استبدال', can.final && c.approval === 'primary')].join('')}</div></td></tr>`;
}

const ROLE = { creator: 'منشئ الطلب', tech_reviewer: 'مراجع فني', approver: 'المعتمد النهائي', single_admin: 'مسؤول مخوّل (منشأة صغيرة)', supplier_agent: 'مسؤول المورد', doc_reviewer: 'مراجع الوثائق' };
const STATUS = { draft: 'مسودة', approved: 'معتمد', assigned: 'مسند لمورد', closed: 'مغلق' };
const APPROVAL = { none: 'بانتظار الاعتماد', primary: 'معتمد — أساسي', backup: 'احتياطي', returned: 'أُرجع للتعديل' };
const REVIEW = { pending: 'بانتظار المراجعة', confirmed: 'مؤكد', corrected: 'صُحّح', missing: 'غير متوفر' };
const DOC = { cv: 'السيرة', iqama: 'الإقامة', work_permit: 'تصريح العمل', ajeer_contract: 'عقد أجير', certificate: 'شهادة' };
const DSTATUS = { uploaded: 'مرفوعة', verified_manual: 'تم التحقق يدويًا', unreadable: 'تعذرت قراءتها', expired: 'منتهية — ارفع نسخة سارية' };
const JOB = { queued: 'في الانتظار', processing: 'قيد المعالجة', done: 'تم الاستخراج', failed: 'تعذرت القراءة', duplicate: 'مكرر — للمراجعة' };
const ORGT = { company_large: 'شركة كبرى', company_small: 'منشأة صغيرة', supplier: 'مورد كوادر', platform: 'المنصة' };
const VER = { pending: 'بانتظار التحقق', manual_verified: 'تم التحقق يدويًا', external_verified: 'متحقق لدى جهة خارجية', rejected: 'مرفوض' };
const CHN = { whatsapp: 'واتساب', sms: 'SMS', email: 'البريد', telegram: 'تيليجرام' };
const TPN = { invite: 'دعوة المرشح', availability: 'تأكيد التوفر', interview: 'تحديد المقابلة', missing_doc: 'نقص مستند', start_confirm: 'تأكيد المباشرة' };
const MST = { sending: 'قيد الإرسال', simulated: 'محاكاة', accepted: 'قبلها المزود', partial: 'قبول جزئي', failed: 'فشل' };
const DST = { simulated: 'محاكاة', accepted: 'قبلها المزود', sent: 'أُرسل', delivered: 'تم التسليم', read: 'قُرئ', failed: 'فشل' };
const PROV = { otp: 'التحقق OTP', storage: 'تخزين الملفات', ai: 'استخراج السير (AI)', ocr: 'OCR', whatsapp: 'واتساب', sms: 'SMS', email: 'البريد', telegram: 'تيليجرام' };

// ---------------- actions ----------------
const A = {
  go: (d) => go(d.view, d.view === 'orders' ? {} : {}),
  kind: (d) => { S.kind = d.kind; render(); },
  apply: () => (S.me ? go('me') : go('login')),
  'demo-login': async (d) => { await api('/auth/demo-login', { json: { userId: Number(d.id) } }); await boot(); go(S.me.kind === 'seeker' ? 'me' : S.me.kind === 'platform_admin' ? 'admin' : 'orders'); },
  logout: async () => { await api('/auth/logout', { json: {} }); S.me = null; Object.assign(S, { orderId: null, batch: null }); go('home'); },
  'open-order': (d) => { Object.assign(S, { orderId: Number(d.id), page: 1, filters: {}, list: '', batch: null }); render(); },
  'back-orders': () => { S.orderId = null; render(); },
  'new-order': () => {
    const org = S.me.memberships.find((m) => ['creator', 'single_admin', 'approver'].includes(m.role));
    $('#new-order').innerHTML = `<form data-form="order" class="card" data-org="${org.org_id}"><h3>طلب جديد — ${esc(org.org_name)}</h3><div class="grid">
      ${[['title', 'عنوان الطلب'], ['profession', 'المهنة'], ['specialties', 'التخصصات (بفاصلة)'], ['quantity', 'العدد', 'number'], ['city', 'المدينة'], ['site', 'الموقع/المشروع'], ['duration', 'المدة'], ['shifts', 'الورديات'], ['startDate', 'موعد المباشرة', 'date'], ['requiredCerts', 'الشهادات المطلوبة'], ['requiredSkills', 'المهارات المطلوبة']].map(([n, l, t]) => `<div class="field"><label for="o-${n}">${l}</label><input id="o-${n}" name="${n}" type="${t || 'text'}" ${['title', 'profession', 'quantity', 'city'].includes(n) ? 'required' : ''}></div>`).join('')}
      <div class="field"><label for="o-kind">النوع</label><select id="o-kind" name="kind"><option value="supply">توريد كوادر</option><option value="direct">توظيف مباشر</option></select></div></div><div class="row end"><button class="btn">حفظ كمسودة</button></div></form>`;
  },
  'approve-order': async () => { await api(`/orders/${S.orderId}/approve`, { json: {} }); toast('اعتُمد الطلب وسُجّل الاعتماد.'); render(); },
  assign: async () => { const r = await api(`/orders/${S.orderId}/assign`, { json: { supplierOrgId: 3 } }); toast(r.warning ? `أُسند الطلب. تنبيه: ${r.warning}` : 'أُسند الطلب للمورد.'); render(); },
  list: (d) => { S.list = d.list; S.page = 1; render(); },
  page: (d) => { S.page += Number(d.d); render(); },
  contact: async (d) => { const note = await ask('رد المرشح (اكتب «نعم» في أوله إن أكد التوفر)'); if (!note) return; await api(`/nominations/${d.id}/contact`, { json: { note, confirmed: /^نعم/.test(note) } }); toast('وُثّق التواصل.'); render(); },
  'tech-pass': async (d) => { await api(`/nominations/${d.id}/tech-review`, { json: { decision: 'passed' } }); toast('سُجّلت المراجعة الفنية.'); render(); },
  primary: async (d) => { await api(`/nominations/${d.id}/approval`, { json: { approval: 'primary' } }); toast('اعتُمد في القائمة الأساسية.'); render(); },
  backup: async (d) => { await api(`/nominations/${d.id}/approval`, { json: { approval: 'backup' } }); toast('نُقل للقائمة الاحتياطية.'); render(); },
  return: async (d) => { const reason = await ask('سبب الإرجاع للتعديل'); if (!reason) return; const can = new Set(S.order.scope.owner); await api(`/nominations/${d.id}/${can.has('approver') || can.has('single_admin') ? 'approval' : 'tech-review'}`, { json: can.has('approver') || can.has('single_admin') ? { approval: 'returned', reason } : { decision: 'returned', reason } }); toast('أُرجع مع السبب.'); render(); },
  interview: async (d) => { await api(`/nominations/${d.id}/interview`, { json: {} }); toast('سُجّلت المقابلة.'); render(); },
  start: async (d) => { await api(`/nominations/${d.id}/start`, { json: {} }); toast('سُجّلت المباشرة الفعلية.'); render(); },
  replace: async (d) => { const code = await ask('معرّف المرشح البديل (مثل W-1102)'); if (!code) return; const reason = await ask('سبب الاستبدال'); if (!reason) return; await api(`/nominations/${d.id}/replace`, { json: { newCandidateCode: code, reason } }); toast('اعتُمد البديل وربط بالمرشح السابق.'); render(); },
  retry: async (d) => { await api(`/cv-jobs/${d.id}/retry`, { json: {} }); render(); },
  'fix-field': async (d) => { const v = await ask(`القيمة الصحيحة: ${d.label}`); if (v == null) return; await api(`/me/fields/${d.id}`, { method: 'PATCH', json: { value: v } }); toast('صُحّح الحقل وسيُستخدم في المطابقة.'); render(); },
  withdraw: async (d) => { const r = await api(`/me/consents/${d.id}/withdraw`, { json: {} }); toast(r.note); render(); },
  grant: async (d) => { await api('/me/consents', { json: { scope: d.scope } }); toast('سُجّلت الموافقة ونطاقها.'); render(); },
  channel: (d) => { S.msg.channel = d.ch; S.msg.key = null; render(); },
  send: async () => { const r = await api(`/orders/${S.orderId}/messages`, { json: { channel: S.msg.channel, template: S.msg.template, idempotencyKey: S.msg.key } }); toast(r.duplicate ? 'هذه الدفعة أُرسلت مسبقًا — لم يُكرر الإرسال.' : `الحالة: ${MST[r.message.status] || r.message.status} · ${r.message.recipient_count} مستلمًا.`); render(); },
  refresh: () => render(),
  'ai-test': async () => {
    const out = $('#ai-test-out'); out.textContent = 'جارٍ الاختبار…';
    const r = await api('/admin/ai/test', { json: {} });
    out.textContent = `أجاب: ${r.provider}` + (r.attempts.length ? ' · ' + r.attempts.map((a) => `${a.provider}: ${a.ok ? `نجح (${a.ms}ms)` : a.error}`).join(' ← ') : ' (لا مزودين في AI_CHAIN — الاستخراج المحلي فقط)');
  },
  'verify-org': async (d) => { await api(`/admin/orgs/${d.id}/verify`, { json: {} }); toast('سُجّل «تم التحقق يدويًا».'); render(); },
};

const FORMS = {
  'otp-request': async (fd) => { const r = await api('/auth/otp/request', { json: { destination: fd.get('destination') } }); S.otpDest = fd.get('destination'); toast(r.devCode ? `رمز تجريبي (محاكاة): ${r.devCode}` : 'أُرسل الرمز.'); },
  'otp-verify': async (fd) => { await api('/auth/otp/verify', { json: { destination: S.otpDest, code: fd.get('code') } }); await boot(); go('me'); },
  nominate: async (fd) => { await api(`/orders/${S.orderId}/nominations`, { json: { candidateCode: fd.get('code') } }); toast('أُضيف المرشح ويُعرض مع أسباب مطابقته.'); render(); },
  order: async (fd, form) => { const o = Object.fromEntries(fd); o.orgId = Number(form.dataset.org); o.quantity = Number(o.quantity); const r = await api('/orders', { json: o }); toast(`أُنشئ ${r.code} كمسودة.`); S.orderId = r.id; render(); },
  batch: async (fd) => { const r = await fetch(`/api/orders/${S.orderId}/cv-batch`, { method: 'POST', body: fd, credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) throw new Error(j.message); S.batch = j.batchId; const rej = j.files.filter((f) => f.status === 'rejected'); if (rej.length) toast(`رُفض ${rej.length} ملف: النوع غير مقبول.`); render(); },
  cv: async (fd) => { const r = await fetch('/api/me/cv', { method: 'POST', body: fd, credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) throw new Error(j.message); toast(j.warning ? `رُفعت السيرة. ${j.warning}` : 'استُخرجت الحقول — راجعها.'); render(); },
  doc: async (fd) => { const me = await api('/me/profile'); const r = await fetch(`/api/candidates/${me.candidate.id}/documents`, { method: 'POST', body: fd, credentials: 'same-origin' }); const j = await r.json(); if (!r.ok) throw new Error(j.message); toast(j.status === 'expired' ? 'الوثيقة منتهية: أُنشئت مهمة مراجعة.' : 'رُفعت الوثيقة.'); render(); },
  profile: async (fd) => { await api('/me/profile', { method: 'PATCH', json: { profession: fd.get('profession') || null, acceptedCities: fd.get('acceptedCities') || null, acceptsRelocation: fd.get('acceptsRelocation') === 'on', availableFrom: fd.get('availableFrom') || null } }); toast('حُفظ.'); },
  ticket: async (fd) => { const r = await api('/support/tickets', { json: { body: fd.get('body'), orderId: fd.get('orderId') || null } }); toast(`سُجّل البلاغ ${r.code}.`); render(); },
  'support-info': async (fd) => { const v = {}; for (const [k, x] of fd) if (x) v[k] = x; await api('/admin/support', { method: 'PUT', json: v }); toast('حُدّثت بيانات الدعم.'); },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  try { await A[el.dataset.action](el.dataset, el); } catch (err) { toast(err.message); }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('form[data-form]');
  if (!f) { if (e.target.id === 'search-form') { e.preventDefault(); S.q = $('#q').value.trim(); go('home'); } return; }
  e.preventDefault();
  const btn = f.querySelector('button:not([value])'); if (btn) btn.disabled = true;
  try { await FORMS[f.dataset.form](new FormData(f), f); } catch (err) { toast(err.message); } finally { if (btn) btn.disabled = false; }
});
let filterT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.filter) { clearTimeout(filterT); filterT = setTimeout(() => { if (t.value) S.filters[t.dataset.filter] = t.value; else delete S.filters[t.dataset.filter]; S.page = 1; render().then(() => { const n = document.querySelector(`[data-filter="${t.dataset.filter}"]`); if (n && n.tagName === 'INPUT') { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, t.tagName === 'SELECT' ? 0 : 350); }
  if (t.dataset.msg === 'template') { S.msg.template = t.value; S.msg.key = null; render(); }
  if (t.dataset.msg === 'order') { S.orderId = Number(t.value); S.msg.key = null; render(); }
});

async function boot() { S.me = (await api('/auth/me')).user; renderNav(); }
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot().then(() => go('home'));
