const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3210);
const ROOT = path.resolve(__dirname);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DATA_FILE = path.join(DATA_DIR, 'orders.json');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const IS_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
// Railway에서는 기본 비밀번호로 폴백하지 않습니다. 환경변수가 실제 배포에 적용되어야만 관리자 로그인이 됩니다.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_RAILWAY ? '' : 'change-this-password');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon'
};

fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');

function readOrders() {
  try {
    const rows = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    console.error('주문 데이터 읽기 오류:', error.message);
    return [];
  }
}

function writeOrders(rows) {
  const temp = DATA_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(rows, null, 2), 'utf8');
  fs.renameSync(temp, DATA_FILE);
}


function orderYear(order, fallbackDate = new Date()) {
  const iso = String(order && order.createdAtIso || '');
  const match = iso.match(/^(\d{4})-/);
  if (match) return match[1];
  const idMatch = String(order && order.id || '').match(/^(\d{4})-\d{3,}$/);
  if (idMatch) return idMatch[1];
  return String(fallbackDate.getFullYear());
}

function nextOrderId(rows, date = new Date()) {
  const year = String(date.getFullYear());
  let max = 0;
  for (const row of rows) {
    const match = String(row && row.id || '').match(new RegExp('^' + year + '-(\\d+)$'));
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  return `${year}-${String(max + 1).padStart(3, '0')}`;
}

function migrateLegacyOrderIds() {
  const rows = readOrders();
  if (!rows.length) return;
  const used = new Set(rows.map(r => String(r.id || '')).filter(id => /^\d{4}-\d{3,}$/.test(id)));
  const counters = new Map();
  for (const id of used) {
    const [year, seq] = id.split('-');
    counters.set(year, Math.max(counters.get(year) || 0, Number(seq) || 0));
  }

  let changed = false;
  const ordered = [...rows].sort((a, b) => {
    const aTime = Date.parse(a.createdAtIso || '') || Number(a.storageId) || 0;
    const bTime = Date.parse(b.createdAtIso || '') || Number(b.storageId) || 0;
    return aTime - bTime;
  });

  for (const row of ordered) {
    const current = String(row.id || '');
    if (/^\d{4}-\d{3,}$/.test(current)) continue;
    const year = orderYear(row);
    const next = (counters.get(year) || 0) + 1;
    counters.set(year, next);
    const newId = `${year}-${String(next).padStart(3, '0')}`;
    row.id = newId;
    changed = true;
  }
  if (changed) {
    writeOrders(rows);
    console.log('기존 주문번호를 연도-일련번호 형식으로 변환했습니다.');
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function readJson(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > limit) {
        reject(Object.assign(new Error('요청 데이터가 너무 큽니다.'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(Object.assign(new Error('잘못된 JSON 형식입니다.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function basicAuthorized(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return false;
    const user = decoded.slice(0, idx);
    const pass = decoded.slice(idx + 1);
    return crypto.timingSafeEqual(Buffer.from(user), Buffer.from(ADMIN_USER)) &&
      crypto.timingSafeEqual(Buffer.from(pass), Buffer.from(ADMIN_PASSWORD));
  } catch { return false; }
}

function demandAdmin(req, res) {
  if (!ADMIN_PASSWORD) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end('관리자 비밀번호가 서버에 적용되지 않았습니다. Railway의 staged changes를 Deploy해 주세요.');
    return false;
  }
  if (basicAuthorized(req)) return true;
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="Geulgyeol Admin", charset="UTF-8"',
    'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'
  });
  res.end('관리자 인증이 필요합니다.');
  return false;
}

function sanitizeNewOrder(data, existingRows = []) {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  return {
    id: nextOrderId(existingRows, nowDate),
    createdAt: data.createdAt || new Date().toLocaleString('ko-KR'),
    name: String(data.name || '').slice(0, 100), phone: String(data.phone || '').slice(0, 50),
    email: String(data.email || '').slice(0, 200), workType: String(data.workType || '').slice(0, 100),
    workShape: String(data.workShape || '').slice(0, 100), workSize: String(data.workSize || '').slice(0, 100),
    writingMood: String(data.writingMood || '').slice(0, 100), dueDate: String(data.dueDate || '').slice(0, 50),
    recipient: String(data.recipient || '').slice(0, 200), story: String(data.story || '').slice(0, 5000),
    sentence: String(data.sentence || '').slice(0, 5000), usedAi: Boolean(data.usedAi),
    aiLengthRange: String(data.aiLengthRange || ''), sentenceCharacterCount: Number(data.sentenceCharacterCount) || 0,
    extra: String(data.extra || '').slice(0, 5000), referenceImage1: String(data.referenceImage1 || ''),
    referenceImage2: String(data.referenceImage2 || ''), status: '신규 접수', paymentStatus: '미입금',
    basePrice: 0, receivedAmount: 0, extraAmount: 0, completedDate: '', trackingNumber: '',
    customerReview: '', adminMemo: '', customerVisible: false, customerMessage: '', publicWork: false,
    completedImage: '', createdAtIso: now, updatedAtIso: now
  };
}

function publicGalleryOrder(o) {
  return { workType: o.workType || '', sentence: o.sentence || '', completedDate: o.completedDate || '', completedImage: o.completedImage || '' };
}

async function handleApi(req, res, pathname) {
  if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

  if (pathname === '/api/orders' && req.method === 'POST') {
    const body = await readJson(req);
    if (!String(body.name || '').trim() || !String(body.phone || '').trim() || !String(body.workType || '').trim() || !String(body.story || '').trim()) {
      return sendJson(res, 400, { error: '필수 입력 항목이 빠졌습니다.' });
    }
    const rows = readOrders();
    const order = sanitizeNewOrder(body, rows);
    const maxId = rows.reduce((m, r) => Math.max(m, Number(r.storageId) || 0), 0);
    order.storageId = maxId + 1;
    rows.push(order);
    writeOrders(rows);
    return sendJson(res, 201, { storageId: order.storageId, id: order.id });
  }

  if (pathname === '/api/customer/lookup' && req.method === 'POST') {
    const body = await readJson(req, 64 * 1024);
    const number = String(body.orderNumber || '').trim().toLowerCase();
    const last4 = String(body.last4 || '').replace(/\D/g, '');
    const order = readOrders().find(o => String(o.id || o.storageId).trim().toLowerCase() === number && String(o.phone || '').replace(/\D/g, '').slice(-4) === last4);
    if (!order) return sendJson(res, 404, { error: 'not_found' });
    if (!order.customerVisible) return sendJson(res, 403, { error: 'not_visible' });
    const safe = { id: order.id, storageId: order.storageId, status: order.status, workType: order.workType, workSize: order.workSize,
      sentence: order.sentence, completedDate: order.completedDate, customerMessage: order.customerMessage,
      completedImage: order.completedImage, trackingNumber: order.trackingNumber };
    return sendJson(res, 200, safe);
  }

  if (pathname === '/api/gallery' && req.method === 'GET') {
    const rows = readOrders().filter(o => o.publicWork && o.completedImage).sort((a,b)=>(b.storageId||0)-(a.storageId||0)).map(publicGalleryOrder);
    return sendJson(res, 200, rows);
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!demandAdmin(req, res)) return;
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      return sendJson(res, 200, readOrders().sort((a,b)=>(b.storageId||0)-(a.storageId||0)));
    }
    if (pathname === '/api/admin/import' && req.method === 'POST') {
      const body = await readJson(req);
      if (!Array.isArray(body.orders)) return sendJson(res, 400, { error: 'orders 배열이 필요합니다.' });
      const current = readOrders();
      const byKey = new Map(current.map(o => [String(o.id || o.storageId), o]));
      let maxId = current.reduce((m, r) => Math.max(m, Number(r.storageId) || 0), 0);
      for (const raw of body.orders) {
        const key = String(raw.id || raw.storageId || '');
        const existing = byKey.get(key);
        const merged = { ...(existing || sanitizeNewOrder(raw, current)), ...raw, updatedAtIso: new Date().toISOString() };
        if (!merged.storageId) merged.storageId = ++maxId;
        byKey.set(String(merged.id || merged.storageId), merged);
      }
      const rows = Array.from(byKey.values());
      writeOrders(rows);
      return sendJson(res, 200, { imported: body.orders.length });
    }
    const match = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (match && req.method === 'PUT') {
      const id = Number(match[1]);
      const body = await readJson(req);
      const rows = readOrders();
      const idx = rows.findIndex(o => Number(o.storageId) === id);
      if (idx < 0) return sendJson(res, 404, { error: 'not_found' });
      rows[idx] = { ...rows[idx], ...body, storageId: id, updatedAtIso: new Date().toISOString() };
      writeOrders(rows);
      return sendJson(res, 200, rows[idx]);
    }
    if (match && req.method === 'DELETE') {
      const id = Number(match[1]);
      const rows = readOrders();
      const filtered = rows.filter(o => Number(o.storageId) !== id);
      if (filtered.length === rows.length) return sendJson(res, 404, { error: 'not_found' });
      writeOrders(filtered);
      return sendJson(res, 200, { ok: true });
    }
  }
  return false;
}

function serveStatic(req, res, pathname) {
  if ((pathname === '/admin.html' || pathname === '/admin.js') && !demandAdmin(req, res)) return;
  if (pathname === '/') pathname = '/index.html';
  const relativePath = pathname.replace(/^[/\\]+/, '');
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('접근할 수 없습니다.');
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('파일을 찾을 수 없습니다.'); }
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('파일을 읽을 수 없습니다.'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('잘못된 주소입니다.'); }
  try {
    if (pathname === '/healthz' || pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, pathname);
      if (handled !== false) return;
      return sendJson(res, 404, { error: 'not_found' });
    }
    serveStatic(req, res, pathname);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) sendJson(res, error.status || 500, { error: error.message || 'server_error' });
  }
});

migrateLegacyOrderIds();

server.listen(PORT, HOST, () => {
  console.log(`글결 서버 실행: http://${HOST}:${PORT}`);
  console.log(`데이터 위치: ${DATA_FILE}`);
  if (!ADMIN_PASSWORD) console.warn('주의: Railway에 ADMIN_PASSWORD가 적용되지 않았습니다. Variables 변경 후 staged changes의 Deploy를 실행하세요.');
  else if (!IS_RAILWAY && ADMIN_PASSWORD === 'change-this-password') console.warn('주의: 로컬 기본 관리자 비밀번호를 사용 중입니다.');
});
