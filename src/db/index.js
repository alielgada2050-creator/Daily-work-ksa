// [MOD-DB] PostgreSQL pool, or in-memory pg-mem for demo/tests (same SQL).
const fs = require('fs');
const path = require('path');
const config = require('../config');

let pool;

function createPool() {
  if (config.databaseUrl) {
    const { Pool } = require('pg');
    return new Pool({ connectionString: config.databaseUrl });
  }
  const { newDb } = require('pg-mem');
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool } = mem.adapters.createPg();
  return new Pool();
}

function getPool() {
  if (!pool) pool = createPool();
  return pool;
}

async function query(sql, params = []) {
  const res = await getPool().query(sql, params);
  return res.rows;
}

async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function migrate() {
  const dir = path.join(__dirname, 'migrations');
  await query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  const done = new Set((await query('SELECT name FROM schema_migrations')).map((r) => r.name));
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const stmt of sql.split(/;\s*\n/).map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)) {
      await query(stmt);
    }
    await query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
  }
}

// Tests only: wipes the schema when explicitly allowed (TEST_RESET_DB=1). Never set this against real data.
async function resetForTests() {
  if (config.databaseUrl && process.env.TEST_RESET_DB === '1') {
    await query('DROP SCHEMA public CASCADE');
    await query('CREATE SCHEMA public');
  }
}

async function reset() {
  if (pool && pool.end) await pool.end().catch(() => {});
  pool = undefined;
}

module.exports = { query, one, migrate, reset, resetForTests, getPool };
