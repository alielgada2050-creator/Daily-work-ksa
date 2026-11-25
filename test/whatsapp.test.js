// WhatsApp Cloud API integration test against a local fake Graph API (no network, no real account).
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const request = require('supertest');

let graph; let calls = []; let app; let db; let ORDER;
const SECRET = 'test-app-secret';
const FAIL_TO = '966500000999';

test.before(async () => {
  graph = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const j = JSON.parse(body);
      calls.push({ url: req.url, auth: req.headers.authorization, body: j });
      res.setHeader('content-type', 'application/json');
      if (j.to === FAIL_TO) { res.statusCode = 400; return res.end(JSON.stringify({ error: { code: 131026, message: 'Message undeliverable' } })); }
      res.end(JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ wa_id: j.to }], messages: [{ id: `wamid.${calls.length}` }] }));
    });
  });
  await new Promise((r) => graph.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    DEMO_MODE: 'true', API_RATE_LIMIT: '100000', STORAGE_DIR: require('path').join(require('os').tmpdir(), `wa-test-${process.pid}`),
    WHATSAPP_PROVIDER: 'cloud_api', WHATSAPP_API_BASE: `http://127.0.0.1:${graph.address().port}/v21.0`,
    WHATSAPP_TOKEN: 'test-token', WHATSAPP_PHONE_ID: '123456', WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: 'verify-me',
    WHATSAPP_TEMPLATE_AVAILABILITY: 'wasla_availability_ar',
  });
  db = require('../src/db');
  await db.resetForTests();
  await db.migrate();
  ORDER = (await require('../src/db/seed').seed()).orderId;
  app = require('../src/app').createApp();
  // one recipient whose number the fake API rejects -> partial batch
  await db.query("UPDATE candidates SET phone = '+966500000999' WHERE code = 'W-1002'");
});

test.after(() => graph.close());

async function as(id) { const a = request.agent(app); await a.post('/api/auth/demo-login').send({ userId: id }).expect(200); return a; }
const sign = (raw) => `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;

test('webhook verification handshake', async () => {
  const ok = await request(app).get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42').expect(200);
  assert.equal(ok.text, '42');
  await request(app).get('/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42').expect(403);
});

test('template without an approved WhatsApp mapping is refused before sending', async () => {
  const sup = await as(5);
  const r = await sup.post(`/api/orders/${ORDER}/messages`).send({ channel: 'whatsapp', template: 'invite', idempotencyKey: 'wa-no-template-1' }).expect(424);
  assert.match(r.body.message, /WHATSAPP_TEMPLATE_INVITE/);
});

test('real send path: approved template, per-recipient results, idempotent retry, signed status webhooks', async () => {
  calls = [];
  const sup = await as(5);
  const r = await sup.post(`/api/orders/${ORDER}/messages`).send({ channel: 'whatsapp', template: 'availability', idempotencyKey: 'wa-batch-0001' }).expect(201);
  assert.equal(r.body.message.status, 'partial');
  const n = r.body.message.recipient_count;
  assert.equal(calls.length, n);
  assert.equal(calls[0].url, '/v21.0/123456/messages');
  assert.equal(calls[0].auth, 'Bearer test-token');
  assert.equal(calls[0].body.type, 'template');
  assert.equal(calls[0].body.template.name, 'wasla_availability_ar');
  assert.equal(calls[0].body.template.language.code, 'ar');
  assert.match(calls[0].body.to, /^9665\d{8}$/);
  assert.equal(r.body.message.counts.failed, 1);
  assert.equal(r.body.message.counts.accepted, n - 1);

  // retry with the same key: no new provider calls
  const again = await sup.post(`/api/orders/${ORDER}/messages`).send({ channel: 'whatsapp', template: 'availability', idempotencyKey: 'wa-batch-0001' }).expect(200);
  assert.equal(again.body.duplicate, true);
  assert.equal(calls.length, n);

  // webhook: delivered then a late "sent" (must not downgrade); bad signature rejected
  const payload = (id, status) => Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id, status, timestamp: '1' }] } }] }] }));
  const ids = (await db.query("SELECT provider_message_id FROM message_deliveries WHERE provider_message_id IS NOT NULL ORDER BY id LIMIT 2")).map((x) => x.provider_message_id);
  const d1 = payload(ids[0], 'delivered');
  await request(app).post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', 'sha256=bad').send(d1.toString()).expect(401);
  await request(app).post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sign(d1)).send(d1.toString()).expect(200);
  const s1 = payload(ids[0], 'sent');
  await request(app).post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sign(s1)).send(s1.toString()).expect(200);
  const s2 = payload(ids[1], 'read');
  await request(app).post('/api/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', sign(s2)).send(s2.toString()).expect(200);

  const list = (await sup.get(`/api/orders/${ORDER}/messages`).expect(200)).body.items[0];
  assert.equal(list.counts.delivered, 1);
  assert.equal(list.counts.read, 1);
  assert.equal(list.counts.accepted, n - 3);
});

test('another company cannot read the message history', async () => {
  const other = await as(8);
  await other.get(`/api/orders/${ORDER}/messages`).expect(403);
});
