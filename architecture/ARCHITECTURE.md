# المعمارية الهندسية — وصلة عمل

الخريطة الكاملة في `graph.json` (عُقد + علاقات زمنية + حلقات). لكل جزء معرّف ثابت مكتوب كتعليق في الكود، مثل `// [MOD-NOMINATIONS]` أو `<!-- [UI-SHELL] -->`.

**للوصول لجزء:** `grep -rn "\[MOD-REPORTS\]" src public`
**قبل أي تعديل:** `npm run impact -- MOD-REPORTS 2` يعرض كل ما قد يتأثر.
**بعد التعديل:** عدّل `architecture/build-graph.js` (العلاقة القديمة تأخذ `invalid_at` ولا تُحذف)، شغّل `node architecture/build-graph.js`، وأضف حلقة في `CHANGELOG.arch.md`.

```mermaid
flowchart LR
  subgraph UI[الواجهات — public/]
    HOME[UI-HOME] --- ORDER[UI-COMPANY-ORDER] --- SUP[UI-SUPPLIER-PORTAL]
    SEEK[UI-SEEKER-PROFILE] --- MSG[UI-MESSAGES] --- ADM[UI-ADMIN]
    SUPP[UI-SUPPORT] --- SET[UI-SETTINGS]
  end
  subgraph MOD[الوحدات — src/]
    AUTH[MOD-AUTH]; ORGS[MOD-ORGS صلاحيات وعزل]; ORD[MOD-ORDERS]; NOM[MOD-NOMINATIONS]
    DOCS[MOD-DOCS]; CV[MOD-CV-PARSE]; MS[MOD-MESSAGING]; REP[MOD-REPORTS]; AUD[MOD-AUDIT]; MKT[MOD-MARKETS]
  end
  subgraph DATA[PostgreSQL]
    D1[(orders / nominations)]; D2[(candidates / cv_fields / documents)]; D3[(consents / messages)]; D4[(audit_log / markets)]
  end
  subgraph EXT[مزودون قابلون للتبديل]
    OTP[EXT-OTP]; ST[EXT-STORAGE]; AI[EXT-AI-OCR<br/>FreeLLMAPI]; WA[EXT-WHATSAPP]; SMS[EXT-SMS]; EM[EXT-EMAIL]; TG[EXT-TELEGRAM]
  end
  HOME --> ORD; ORDER --> ORD & NOM & REP; SUP --> CV; SEEK --> DOCS; MSG --> MS; ADM --> MKT & AUD
  ORD & NOM & REP & MS & DOCS --> ORGS
  ORD & NOM --> D1; CV & DOCS --> D2; MS --> D3; AUD & MKT --> D4
  CV --> AI; DOCS --> ST; AUTH --> OTP; MS --> WA & SMS & EM & TG
```

## قواعد العمل
| المعرّف | القاعدة | المكان |
|---|---|---|
| RULE-GAP | العجز = المطلوب − المؤهل؛ المتبقي = المطلوب − المباشر | `src/lib/core.js#orderKpis` |
| RULE-NO-DUP-NOMINATION | لا يُضاف الشخص مرتين للطلب (قيد UNIQUE + فحص) | `src/modules/orders.js#nominate` |
| RULE-CONSENT-BEFORE-SHARE | الاسم والجوال والرسائل حسب موافقة المرشح النشطة | `orders.js#present`, `#recipients` |
| RULE-EXPORT-DEFAULT-COLUMNS | التصدير الافتراضي بلا اسم/جوال/هوية/إقامة | `orders.js#DEFAULT_COLS` |
| RULE-AGE-EXCLUDED | العمر من تاريخ ميلاد صريح فقط، خارج الترتيب والتصدير | `core.js#match`, `ai.js` |
| RULE-CV-IS-DATA | نص السيرة مسوّر ولا تُنفَّذ تعليماته، ولا يرى النموذج مفاتيح أو أدوات | `src/providers/ai.js` |

## مسار الاعتماد
- **شركة كبرى:** منشئ الطلب ← مراجع فني (`tech-review`) ← معتمد نهائي (`approval`). الاعتماد النهائي يُرفض قبل اجتياز المراجعة الفنية.
- **منشأة صغيرة:** دور واحد `single_admin` يراجع ويعتمد.
- كل اعتماد وإرجاع يُسجَّل مع سببه في `audit_log`.

## القرارات (ADR)
- **ADR-001** تطبيق وحدوي (Express + PostgreSQL) بوحدات منفصلة منطقيًا؛ الفصل لخدمات لاحقًا عند الحاجة.
- **ADR-002** `pg-mem` للتشغيل التجريبي بنفس SQL، و`DATABASE_URL` للتشغيل الفعلي.
- **ADR-003** واجهة Vanilla JS بلا خطوة بناء، مع CSP صارم بلا سكربتات أو أنماط مضمنة.
- **ADR-004** استخراج السير عبر أي مزود متوافق مع OpenAI (FreeLLMAPI محليًا افتراضيًا)، مع احتياط محلي.
