const fs = require('fs');
const path = require('path');

function createStorage(options = {}) {
  const root = options.root || __dirname;
  const dataDir = path.resolve(options.dataDir || path.join(root, 'data'));
  const dataFile = path.join(dataDir, 'orders.json');
  const settingsFile = path.join(dataDir, 'settings.json');
  const databaseUrl = process.env.DATABASE_URL || '';
  const usePostgres = Boolean(databaseUrl);
  let pool = null;

  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) fs.writeFileSync(dataFile, '[]', 'utf8');
  if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, '{}', 'utf8');

  function readJsonOrders() {
    try {
      const rows = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      return Array.isArray(rows) ? rows : [];
    } catch (error) {
      console.error('주문 데이터 읽기 오류:', error.message);
      return [];
    }
  }

  function writeJsonOrders(rows) {
    const temp = dataFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(rows, null, 2), 'utf8');
    fs.renameSync(temp, dataFile);
  }

  function orderYear(order, fallbackDate = new Date()) {
    const iso = String(order && order.createdAtIso || '');
    const match = iso.match(/^(\d{4})-/);
    if (match) return match[1];
    const idMatch = String(order && order.id || '').match(/^(\d{4})-\d{3,}$/);
    if (idMatch) return idMatch[1];
    return String(fallbackDate.getFullYear());
  }

  function nextJsonOrderId(rows, date = new Date()) {
    const year = String(date.getFullYear());
    let max = 0;
    for (const row of rows) {
      const match = String(row && row.id || '').match(new RegExp('^' + year + '-(\\d+)$'));
      if (match) max = Math.max(max, Number(match[1]) || 0);
    }
    return `${year}-${String(max + 1).padStart(3, '0')}`;
  }

  function normalizeDbRow(row) {
    const payload = row && row.payload && typeof row.payload === 'object' ? row.payload : {};
    return {
      ...payload,
      storageId: Number(row.storage_id),
      id: String(row.order_number)
    };
  }

  async function nextPgOrderId(client, date = new Date()) {
    const year = String(date.getFullYear());
    // 같은 해에 주문이 동시에 들어와도 번호가 겹치지 않도록 연도별 잠금을 사용합니다.
    await client.query('SELECT pg_advisory_xact_lock($1)', [Number(year)]);
    const result = await client.query(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(order_number, '-', 2) AS INTEGER)), 0) AS max_seq
       FROM orders
       WHERE order_number ~ $1`,
      [`^${year}-[0-9]+$`]
    );
    const next = Number(result.rows[0].max_seq || 0) + 1;
    return `${year}-${String(next).padStart(3, '0')}`;
  }

  async function initPostgres() {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: databaseUrl, max: 5 });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        storage_id BIGSERIAL PRIMARY KEY,
        order_number TEXT UNIQUE NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number)');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 기존 JSON 파일에 주문이 있고 DB가 비어 있으면 최초 1회 자동 이관합니다.
    const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM orders');
    const legacyRows = readJsonOrders();
    if (Number(countResult.rows[0].count) === 0 && legacyRows.length) {
      console.log(`기존 orders.json 주문 ${legacyRows.length}건을 PostgreSQL로 이관합니다.`);
      await importOrders(legacyRows);
    }
  }

  async function init() {
    if (!usePostgres) {
      console.log(`주문 저장 방식: 로컬 JSON (${dataFile})`);
      return;
    }
    await initPostgres();
    console.log('주문 저장 방식: PostgreSQL');
  }

  async function listOrders() {
    if (!usePostgres) return readJsonOrders().sort((a, b) => (b.storageId || 0) - (a.storageId || 0));
    const result = await pool.query('SELECT storage_id, order_number, payload FROM orders ORDER BY storage_id DESC');
    return result.rows.map(normalizeDbRow);
  }

  async function createOrder(buildOrder) {
    if (!usePostgres) {
      const rows = readJsonOrders();
      const now = new Date();
      const order = buildOrder(nextJsonOrderId(rows, now));
      const maxId = rows.reduce((m, r) => Math.max(m, Number(r.storageId) || 0), 0);
      order.storageId = maxId + 1;
      rows.push(order);
      writeJsonOrders(rows);
      return order;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderNumber = await nextPgOrderId(client, new Date());
      const order = buildOrder(orderNumber);
      const inserted = await client.query(
        `INSERT INTO orders(order_number, payload, created_at, updated_at)
         VALUES ($1, $2::jsonb, NOW(), NOW())
         RETURNING storage_id`,
        [orderNumber, JSON.stringify(order)]
      );
      order.storageId = Number(inserted.rows[0].storage_id);
      await client.query('UPDATE orders SET payload=$1::jsonb WHERE storage_id=$2', [JSON.stringify(order), order.storageId]);
      await client.query('COMMIT');
      return order;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }


  async function getOrder(storageId) {
    const id = Number(storageId);
    if (!usePostgres) return readJsonOrders().find(o => Number(o.storageId) === id) || null;
    const result = await pool.query('SELECT storage_id, order_number, payload FROM orders WHERE storage_id=$1 LIMIT 1', [id]);
    return result.rows.length ? normalizeDbRow(result.rows[0]) : null;
  }

  async function findCustomerOrder(orderNumber, last4) {
    const normalized = String(orderNumber || '').trim().toLowerCase();
    const phoneTail = String(last4 || '').replace(/\D/g, '');
    if (!usePostgres) {
      return readJsonOrders().find(o => String(o.id || o.storageId).trim().toLowerCase() === normalized && String(o.phone || '').replace(/\D/g, '').slice(-4) === phoneTail) || null;
    }
    let result;
    if (/^\d+$/.test(normalized)) {
      result = await pool.query('SELECT storage_id, order_number, payload FROM orders WHERE storage_id=$1 LIMIT 1', [Number(normalized)]);
    } else {
      result = await pool.query('SELECT storage_id, order_number, payload FROM orders WHERE LOWER(order_number)=LOWER($1) LIMIT 1', [normalized]);
    }
    if (!result.rows.length) return null;
    const order = normalizeDbRow(result.rows[0]);
    return String(order.phone || '').replace(/\D/g, '').slice(-4) === phoneTail ? order : null;
  }

  async function updateOrder(storageId, patch) {
    const id = Number(storageId);
    if (!usePostgres) {
      const rows = readJsonOrders();
      const idx = rows.findIndex(o => Number(o.storageId) === id);
      if (idx < 0) return null;
      rows[idx] = { ...rows[idx], ...patch, storageId: id, id: rows[idx].id, updatedAtIso: new Date().toISOString() };
      writeJsonOrders(rows);
      return rows[idx];
    }
    const found = await pool.query('SELECT storage_id, order_number, payload FROM orders WHERE storage_id=$1', [id]);
    if (!found.rows.length) return null;
    const current = normalizeDbRow(found.rows[0]);
    const merged = { ...current, ...patch, storageId: id, id: current.id, updatedAtIso: new Date().toISOString() };
    await pool.query('UPDATE orders SET payload=$1::jsonb, updated_at=NOW() WHERE storage_id=$2', [JSON.stringify(merged), id]);
    return merged;
  }

  async function deleteOrder(storageId) {
    const id = Number(storageId);
    if (!usePostgres) {
      const rows = readJsonOrders();
      const filtered = rows.filter(o => Number(o.storageId) !== id);
      if (filtered.length === rows.length) return false;
      writeJsonOrders(filtered);
      return true;
    }
    const result = await pool.query('DELETE FROM orders WHERE storage_id=$1', [id]);
    return result.rowCount > 0;
  }

  async function importOrders(incoming) {
    if (!Array.isArray(incoming)) throw new Error('orders 배열이 필요합니다.');
    if (!usePostgres) {
      const current = readJsonOrders();
      const byKey = new Map(current.map(o => [String(o.id || o.storageId), o]));
      let maxId = current.reduce((m, r) => Math.max(m, Number(r.storageId) || 0), 0);
      for (const raw of incoming) {
        const key = String(raw.id || raw.storageId || '');
        const merged = { ...(byKey.get(key) || {}), ...raw, updatedAtIso: new Date().toISOString() };
        if (!merged.storageId) merged.storageId = ++maxId;
        if (!merged.id) merged.id = nextJsonOrderId(Array.from(byKey.values()), new Date(merged.createdAtIso || Date.now()));
        byKey.set(String(merged.id || merged.storageId), merged);
      }
      writeJsonOrders(Array.from(byKey.values()));
      return incoming.length;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const raw of incoming) {
        const year = orderYear(raw, new Date());
        let orderNumber = /^\d{4}-\d{3,}$/.test(String(raw.id || '')) ? String(raw.id) : '';
        if (!orderNumber) orderNumber = await nextPgOrderId(client, new Date(`${year}-01-01T00:00:00Z`));
        const payload = { ...raw, id: orderNumber, updatedAtIso: new Date().toISOString() };
        const existing = await client.query('SELECT storage_id FROM orders WHERE order_number=$1 LIMIT 1', [orderNumber]);
        if (existing.rows.length) {
          payload.storageId = Number(existing.rows[0].storage_id);
          await client.query('UPDATE orders SET payload=$1::jsonb, updated_at=NOW() WHERE order_number=$2', [JSON.stringify(payload), orderNumber]);
        } else {
          const inserted = await client.query(
            'INSERT INTO orders(order_number,payload,created_at,updated_at) VALUES($1,$2::jsonb,NOW(),NOW()) RETURNING storage_id',
            [orderNumber, JSON.stringify(payload)]
          );
          payload.storageId = Number(inserted.rows[0].storage_id);
          await client.query('UPDATE orders SET payload=$1::jsonb WHERE storage_id=$2', [JSON.stringify(payload), payload.storageId]);
        }
      }
      await client.query('COMMIT');
      return incoming.length;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }


  function readJsonSettings() {
    try {
      const value = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }

  function writeJsonSettings(value) {
    const temp = settingsFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, settingsFile);
  }

  async function getSettings(keys = []) {
    const requested = Array.isArray(keys) ? keys.map(String) : [];
    if (!usePostgres) {
      const all = readJsonSettings();
      if (!requested.length) return all;
      return Object.fromEntries(requested.map(key => [key, String(all[key] || '')]));
    }
    const result = requested.length
      ? await pool.query('SELECT setting_key, setting_value FROM app_settings WHERE setting_key = ANY($1::text[])', [requested])
      : await pool.query('SELECT setting_key, setting_value FROM app_settings');
    const out = {};
    for (const row of result.rows) out[row.setting_key] = row.setting_value;
    for (const key of requested) if (!(key in out)) out[key] = '';
    return out;
  }

  async function setSettings(patch = {}) {
    const clean = {};
    for (const [key, value] of Object.entries(patch || {})) clean[String(key)] = String(value ?? '');
    if (!usePostgres) {
      const merged = { ...readJsonSettings(), ...clean };
      writeJsonSettings(merged);
      return merged;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const [key, value] of Object.entries(clean)) {
        await client.query(`INSERT INTO app_settings(setting_key, setting_value, updated_at) VALUES($1,$2,NOW())
          ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`, [key, value]);
      }
      await client.query('COMMIT');
      return await getSettings(Object.keys(clean));
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  return {
    usePostgres,
    dataFile,
    init,
    listOrders,
    getOrder,
    createOrder,
    findCustomerOrder,
    updateOrder,
    deleteOrder,
    importOrders,
    getSettings,
    setSettings
  };
}

module.exports = { createStorage };
