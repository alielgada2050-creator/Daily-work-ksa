-- [DATA-*] Wasla Amal schema v1
CREATE TABLE markets (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  config TEXT NOT NULL
);

CREATE TABLE orgs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,            -- company_large | company_small | supplier | platform
  verification TEXT NOT NULL DEFAULT 'pending', -- pending | manual_verified | external_verified | rejected
  market_code TEXT NOT NULL REFERENCES markets(code)
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  kind TEXT NOT NULL             -- seeker | member | platform_admin
);

CREATE TABLE memberships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  role TEXT NOT NULL             -- creator | tech_reviewer | approver | single_admin | supplier_agent | doc_reviewer
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TIMESTAMP NOT NULL
);

CREATE TABLE otp_codes (
  id SERIAL PRIMARY KEY,
  destination TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE candidates (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  supplier_org_id INTEGER REFERENCES orgs(id),
  full_name TEXT,
  phone TEXT,
  email TEXT,
  profession TEXT,
  specialty TEXT,
  skills TEXT,
  certs TEXT,
  years_exp INTEGER,
  city TEXT,
  accepted_cities TEXT,
  accepts_relocation BOOLEAN NOT NULL DEFAULT false,
  available_from DATE,
  available BOOLEAN NOT NULL DEFAULT true,
  verification TEXT NOT NULL DEFAULT 'unverified', -- unverified | manual_verified | external_verified | doc_expired
  work_eligibility TEXT NOT NULL DEFAULT 'unknown', -- eligible | needs_permit | unknown
  cv_complete BOOLEAN NOT NULL DEFAULT false,
  birth_date DATE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE cv_fields (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  field TEXT NOT NULL,
  value TEXT,
  source_ref TEXT,
  confidence REAL,
  review_state TEXT NOT NULL DEFAULT 'pending' -- pending | confirmed | corrected | missing
);

CREATE TABLE documents (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  kind TEXT NOT NULL,            -- cv | iqama | work_permit | ajeer_contract | certificate
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded', -- uploaded | verified_manual | unreadable | expired
  expires_on DATE,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE review_tasks (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  reason TEXT NOT NULL,
  action_for_candidate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE consents (
  id SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  recipient_org_id INTEGER REFERENCES orgs(id),
  scope TEXT NOT NULL,           -- share_profile | share_contact | channel_whatsapp | channel_sms | channel_email | channel_telegram | marketing
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  withdrawn_at TIMESTAMP
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  org_id INTEGER NOT NULL REFERENCES orgs(id),
  kind TEXT NOT NULL,            -- supply | direct
  title TEXT NOT NULL,
  profession TEXT NOT NULL,
  specialties TEXT,
  quantity INTEGER NOT NULL,
  city TEXT NOT NULL,
  site TEXT,
  duration TEXT,
  shifts TEXT,
  start_date DATE,
  required_certs TEXT,
  required_skills TEXT,
  requires_work_permit BOOLEAN NOT NULL DEFAULT true,
  visibility TEXT NOT NULL DEFAULT 'public',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | approved | assigned | closed
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  assigned_supplier_org_id INTEGER REFERENCES orgs(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE nominations (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  candidate_id INTEGER NOT NULL REFERENCES candidates(id),
  nominated_by_org_id INTEGER REFERENCES orgs(id),
  score INTEGER NOT NULL DEFAULT 0,
  reasons TEXT,
  review_reasons TEXT,
  qualified BOOLEAN NOT NULL DEFAULT false,
  confirmed BOOLEAN NOT NULL DEFAULT false,
  contact_note TEXT,
  interviewed_at TIMESTAMP,
  approval TEXT NOT NULL DEFAULT 'none', -- none | primary | backup | returned
  approval_reason TEXT,
  tech_review TEXT NOT NULL DEFAULT 'none', -- none | passed | returned
  started_at TIMESTAMP,
  replaced_by_nomination_id INTEGER,
  replaces_nomination_id INTEGER,
  replace_reason TEXT,
  replaced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, candidate_id)
);

CREATE TABLE cv_jobs (
  id SERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  supplier_org_id INTEGER REFERENCES orgs(id),
  filename TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | processing | done | failed | duplicate
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  candidate_id INTEGER REFERENCES candidates(id),
  duplicate_of INTEGER REFERENCES candidates(id)
);

CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  order_id INTEGER REFERENCES orders(id),
  channel TEXT NOT NULL,
  template TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  status TEXT NOT NULL,          -- simulated | sent | delivered | failed
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE support_tickets (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  order_id INTEGER REFERENCES orders(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  at TIMESTAMP NOT NULL DEFAULT NOW(),
  user_id INTEGER,
  org_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  details TEXT
);

CREATE INDEX idx_candidates_specialty ON candidates (specialty);
CREATE INDEX idx_candidates_city ON candidates (city);
CREATE INDEX idx_nominations_order ON nominations (order_id);
CREATE INDEX idx_audit_at ON audit_log (at);
