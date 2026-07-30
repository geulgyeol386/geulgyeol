const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3210);
const ROOT = path.resolve(__dirname);
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const IS_RAILWAY = Boolean(process.env.RAILWAY_ENVIRONMENT_ID || process.env.RAILWAY_PROJECT_ID);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_RAILWAY ? '' : 'change-this-password');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const ORDER_NOTIFICATION_WEBHOOK_URL = process.env.ORDER_NOTIFICATION_WEBHOOK_URL || '';
const ORDER_NOTIFICATION_WEBHOOK_SECRET = process.env.ORDER_NOTIFICATION_WEBHOOK_SECRET || '';
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || 'https://www.ai-seoye.com').replace(/\/$/, '');
const TELEGRAM_BOT_TOKEN_ENV = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID_ENV = process.env.TELEGRAM_CHAT_ID || '';
const { createStorage } = require('./storage');
const storage = createStorage({ root: ROOT, dataDir: DATA_DIR });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon'
};

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
  // 브라우저 기본 인증 팝업을 띄우지 않고 관리자 화면의 자체 로그인 창으로 처리합니다.
  // 특히 모바일 인앱 브라우저에서 WWW-Authenticate 헤더가 반복 로그인 팝업을 만드는 문제를 방지합니다.
  sendJson(res, 401, { error: 'admin_auth_required' });
  return false;
}

function sanitizeNewOrder(data, orderNumber) {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  return {
    id: orderNumber,
    createdAt: data.createdAt || new Date().toLocaleString('ko-KR'),
    name: String(data.name || '').slice(0, 100), phone: String(data.phone || '').slice(0, 50),
    email: String(data.email || '').slice(0, 200), workType: String(data.workType || '미분류').slice(0, 100),
    workShape: String(data.workShape || '').slice(0, 100), workSize: String(data.workSize || '').slice(0, 100),
    writingMood: String(data.writingMood || '').slice(0, 100), dueDate: String(data.dueDate || '').slice(0, 50),
    recipient: String(data.recipient || '').slice(0, 200), story: String(data.story || '').slice(0, 5000),
    sentence: String(data.sentence || '').slice(0, 5000), sentenceMethod: String(data.sentenceMethod || (data.usedAi ? 'ai' : 'direct')).slice(0, 20), usedAi: Boolean(data.usedAi),
    aiLengthRange: String(data.aiLengthRange || ''), aiPreferredStyle: String(data.aiPreferredStyle || '').slice(0, 100),
    aiEmphasis: String(data.aiEmphasis || '').slice(0, 300), aiGenerationCount: Math.max(0, Number(data.aiGenerationCount) || 0),
    aiRefinementCount: Math.max(0, Number(data.aiRefinementCount) || 0), aiSelectedCandidate: Math.max(0, Number(data.aiSelectedCandidate) || 0),
    aiLastRefinement: String(data.aiLastRefinement || '').slice(0, 300), sentenceCharacterCount: Number(data.sentenceCharacterCount) || 0,
    extra: String(data.extra || '').slice(0, 5000), referenceImage1: String(data.referenceImage1 || ''),
    referenceImage2: String(data.referenceImage2 || ''), status: '신규 접수', paymentStatus: '미입금',
    basePrice: 0, receivedAmount: 0, extraAmount: 0, completedDate: '', trackingNumber: '',
    customerReview: '', adminMemo: '', customerVisible: false, customerMessage: '', publicWork: false,
    featuredWork: false, archiveTitle: '', completedImage: '', progressHistory: [{ at: now, label: '주문 접수', detail: '신규 주문이 접수되었습니다.' }], createdAtIso: now, updatedAtIso: now
  };
}


function historyEntry(label, detail = '') {
  return { at: new Date().toISOString(), label: String(label || '').slice(0, 80), detail: String(detail || '').slice(0, 300) };
}

function appendProgressHistory(current, patch) {
  const history = Array.isArray(current.progressHistory) ? current.progressHistory.slice(-99) : [];
  if (patch.status && patch.status !== current.status) history.push(historyEntry('진행 상태 변경', `${current.status || '미지정'} → ${patch.status}`));
  if (patch.paymentStatus && patch.paymentStatus !== current.paymentStatus) history.push(historyEntry('입금 상태 변경', `${current.paymentStatus || '미지정'} → ${patch.paymentStatus}`));
  if (Object.prototype.hasOwnProperty.call(patch, 'trackingNumber') && patch.trackingNumber !== current.trackingNumber && patch.trackingNumber) history.push(historyEntry('송장번호 등록', patch.trackingNumber));
  if (Object.prototype.hasOwnProperty.call(patch, 'completedImage') && patch.completedImage && patch.completedImage !== current.completedImage) history.push(historyEntry('완성 작품 등록', '완성 작품 사진이 등록되었습니다.'));
  if (Object.prototype.hasOwnProperty.call(patch, 'adminMemo') && patch.adminMemo !== current.adminMemo) history.push(historyEntry('관리자 메모 수정', patch.adminMemo ? '내부 메모가 수정되었습니다.' : '내부 메모가 삭제되었습니다.'));
  return history;
}

async function telegramConfig() {
  const saved = await storage.getSettings(['telegramBotToken', 'telegramChatId']);
  return {
    token: TELEGRAM_BOT_TOKEN_ENV || saved.telegramBotToken || '',
    chatId: TELEGRAM_CHAT_ID_ENV || saved.telegramChatId || '',
    source: TELEGRAM_BOT_TOKEN_ENV ? 'environment' : (saved.telegramBotToken ? 'admin' : '')
  };
}

async function telegramApi(token, method, payload = {}) {
  if (!token) throw Object.assign(new Error('텔레그램 봇 토큰이 등록되지 않았습니다.'), { status: 400 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw Object.assign(new Error(data.description || `텔레그램 API 오류 (${response.status})`), { status: 400 });
    return data.result;
  } finally { clearTimeout(timer); }
}

function telegramOrderText(order) {
  const method = order.usedAi || order.sentenceMethod === 'ai' ? '🤖 AI와 함께 작성' : '✍ 직접 작성';
  const sentence = String(order.sentence || '').trim() || '-';
  return [
    '🔔 글결 신규 주문', '',
    `주문번호: ${order.id || '-'}`,
    `고객: ${order.name || '-'}`,
    `연락처: ${order.phone || '-'}`,
    `작품: ${order.workType || '기타'}`,
    `희망일: ${order.dueDate || '-'}`,
    `문구 방식: ${method}`, '',
    '📝 최종 문구', sentence, '',
    `관리자: ${PUBLIC_BASE_URL}/admin.html`
  ].join('\n');
}

async function sendTelegramMessage(text) {
  const config = await telegramConfig();
  if (!config.token || !config.chatId) return { sent: false, reason: 'not_configured' };
  await telegramApi(config.token, 'sendMessage', { chat_id: config.chatId, text, disable_web_page_preview: true });
  return { sent: true };
}

async function notifyNewOrder(order) {
  try {
    const telegram = await sendTelegramMessage(telegramOrderText(order));
    if (telegram.sent) return;
  } catch (error) {
    console.error('텔레그램 주문 알림 오류:', error.message);
  }
  if (!ORDER_NOTIFICATION_WEBHOOK_URL) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const payload = { event: 'new_order', title: '글결 새 주문 접수',
      message: `새 주문이 접수되었습니다.\n고객: ${order.name || '-'}\n작품: ${order.workType || '기타'}\n주문번호: ${order.id}`,
      order: { id: order.id, storageId: order.storageId, name: order.name, phone: order.phone, workType: order.workType, dueDate: order.dueDate },
      adminUrl: `${PUBLIC_BASE_URL}/admin.html`, sentAt: new Date().toISOString() };
    const headers = { 'Content-Type': 'application/json' };
    if (ORDER_NOTIFICATION_WEBHOOK_SECRET) headers['X-Webhook-Secret'] = ORDER_NOTIFICATION_WEBHOOK_SECRET;
    const response = await fetch(ORDER_NOTIFICATION_WEBHOOK_URL, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) console.error('주문 알림 전송 실패:', response.status);
  } catch (error) { console.error('주문 알림 전송 오류:', error.message); }
  finally { clearTimeout(timer); }
}

function publicGalleryOrder(o) {
  return { workType: o.workType || '', sentence: o.sentence || '', archiveTitle: o.archiveTitle || '', completedDate: o.completedDate || '', completedImage: o.completedImage || '', featuredWork: Boolean(o.featuredWork) };
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.output_text === 'string') return payload.output_text;
  const parts = [];
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    if (item && item.type === 'message') {
      for (const content of Array.isArray(item.content) ? item.content : []) {
        if (content && (content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string') {
          parts.push(content.text);
        }
      }
    }
  }
  return parts.join('\n').trim();
}

function parseAiJson(text) {
  const cleaned = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch {}
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error('AI 응답 형식을 해석하지 못했습니다.');
}

function aiLengthInstruction(range) {
  const map = {
    short: '각 문구는 공백 제외 15~29자를 목표로 하세요.',
    medium: '각 문구는 공백 제외 30~59자를 목표로 하세요.',
    long: '각 문구는 공백 제외 60~99자를 목표로 하세요.',
    veryLong: '각 문구는 공백 제외 90~119자를 목표로 하세요.',
    ultraLong: '각 문구는 공백 제외 120~170자를 목표로 하세요.'
  };
  return map[range] || map.short;
}

async function createAiSuggestions(body) {
  if (!OPENAI_API_KEY) {
    const error = new Error('AI 연결 준비가 아직 되지 않았습니다. Railway Variables에 OPENAI_API_KEY를 등록해 주세요.');
    error.status = 503;
    throw error;
  }

  const mode = String(body.mode || 'initial') === 'refine' ? 'refine' : 'initial';
  const story = String(body.story || '').trim().slice(0, 500);
  const recipient = String(body.recipient || '').trim().slice(0, 200);
  const writingMood = String(body.writingMood || '함께 상의').trim().slice(0, 100);
  const requestedWorkType = String(body.workType || '').trim().slice(0, 100);
  const range = String(body.range || 'short');
  const emphasis = String(body.emphasis || '').trim().slice(0, 160);
  const preferredStyle = String(body.preferredStyle || '다양하게').trim().slice(0, 60);
  const selectedText = String(body.selectedText || '').trim().slice(0, 500);
  const refinement = String(body.refinement || '').trim().slice(0, 160);

  if (!story) {
    const error = new Error('전하고 싶은 마음과 사연을 먼저 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  if (mode === 'refine' && !selectedText) {
    const error = new Error('다듬을 기준 문구를 먼저 선택해 주세요.');
    error.status = 400;
    throw error;
  }

  const count = mode === 'refine' ? 3 : 5;
  const modeInstruction = mode === 'refine'
    ? `아래 기준 문구의 핵심 뜻은 유지하면서 요청한 방향으로 서로 다른 ${count}개의 수정안을 만드세요. 단어만 조금 바꾼 복제 문장은 만들지 마세요.`
    : `서로 성격과 어휘가 분명히 다른 ${count}개의 후보를 만드세요. 같은 문장을 어미만 바꾸어 반복하지 마세요.`;

  const instructions = `당신은 한국 서예 작품을 위한 문구를 제안하는 '글결'의 문안 전문가입니다.
고객이 선택한 작품 종류가 있으면 그것을 우선 반영하고, 사연의 실제 목적과 어긋날 때만 자연스럽게 보완하세요.
가능한 작품 유형: 가훈, 청첩장, 연하장, 감사표시글, 행사답례글, 소품글씨, 인테리어용글귀, 액자, 축하글씨, 입춘첩, 인쇄물표지, 기타.

핵심 원칙:
- 사연의 목적과 원하는 뜻을 최우선으로 반영합니다.
- 고객이 별도로 적은 '강조할 핵심'은 모든 후보에서 분명히 살아 있어야 합니다.
- 사연에 없는 감사, 존경, 이별, 축하 등의 감정을 임의로 끼워 넣지 않습니다.
- 가훈이면 오래 걸어둘 수 있는 교훈적이고 함축적인 문구를 만듭니다.
- 축하글이면 축하의 이유와 바라는 미래를 정확히 반영합니다.
- 청첩장이면 하객에게 보내는 자연스럽고 품격 있는 초대 문구를 만듭니다.
- 감사의 글이면 누구에게 무엇을 감사하는지 구체적으로 반영합니다.
- 연하장과 입춘첩은 계절과 전통의 맥락에 맞춥니다.
- 서예 작품으로 썼을 때 어색한 설명문, 광고문, 과도한 수식어는 피합니다.
- 고객이 특정 뜻이나 고사성어를 말하면 그 의미를 정확히 살립니다.
- 한자 표현은 의미가 정확하고 널리 통용되는 경우에만 한 후보에 제한하여 사용할 수 있습니다.
- 선택한 문체가 '다양하게'가 아니면 모든 후보가 그 문체의 방향을 따르되 표현 방식은 서로 달라야 합니다.
- ${modeInstruction}
- ${aiLengthInstruction(range)}

반드시 JSON만 반환하세요. 형식:
{
  "workType": "위 유형 중 하나",
  "purposeSummary": "사연에서 파악한 목적과 핵심을 35자 이내로 요약",
  "suggestions": [
    {"label":"후보의 문체를 나타내는 짧은 이름","text":"..."}
  ]
}`;

  const userInput = [
    `생성 방식: ${mode === 'refine' ? '선택 문구 다듬기' : '새 후보 만들기'}`,
    `고객이 선택한 작품 종류: ${requestedWorkType || '선택하지 않음'}`,
    `전하는 대상: ${recipient || '별도 지정 없음'}`,
    `글씨 분위기: ${writingMood}`,
    `선호 문체: ${preferredStyle}`,
    `강조할 핵심: ${emphasis || '별도 지정 없음'}`,
    `전하고 싶은 마음과 사연: ${story}`,
    mode === 'refine' ? `기준 문구: ${selectedText}` : '',
    mode === 'refine' ? `다듬기 요청: ${refinement || '같은 뜻을 유지하며 더 완성도 있게'}` : ''
  ].filter(Boolean).join('\n');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions,
      input: userInput,
      reasoning: { effort: 'low' },
      text: { verbosity: 'low' },
      max_output_tokens: mode === 'refine' ? 900 : 1400
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('OpenAI API error:', payload);
    const error = new Error('AI 문구 추천 서비스에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    error.status = response.status >= 500 ? 502 : 500;
    throw error;
  }

  const parsed = parseAiJson(extractResponseText(payload));
  const allowedTypes = new Set(['가훈', '청첩장', '연하장', '감사표시글', '행사답례글', '소품글씨', '인테리어용글귀', '액자', '축하글씨', '입춘첩', '인쇄물표지', '기타']);
  const workType = allowedTypes.has(requestedWorkType) ? requestedWorkType : (allowedTypes.has(parsed.workType) ? parsed.workType : '기타');
  const fallbackLabels = mode === 'refine'
    ? ['정돈한 표현', '감성을 살린 표현', '작품성을 높인 표현']
    : ['담백한 작품형', '품격 있는 문장형', '고풍스러운 표현', '현대적인 감성형', '함축적인 작품형'];
  const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .map((item, index) => ({
      label: String(item && item.label || fallbackLabels[index] || '추천 문구').slice(0, 30),
      text: String(item && item.text || '').trim().slice(0, 500)
    }))
    .filter(item => item.text)
    .slice(0, count);
  if (suggestions.length < count) throw new Error('AI 추천 문구가 충분히 생성되지 않았습니다. 다시 시도해 주세요.');

  return {
    mode,
    workType,
    purposeSummary: String(parsed.purposeSummary || '').trim().slice(0, 100),
    suggestions
  };
}

async function handleApi(req, res, pathname) {
  if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

  if (pathname === '/api/ai/status' && req.method === 'GET') {
    return sendJson(res, 200, { configured: Boolean(OPENAI_API_KEY), model: OPENAI_MODEL });
  }
  if (pathname === '/api/ai/suggestions' && req.method === 'POST') {
    const body = await readJson(req, 128 * 1024);
    const result = await createAiSuggestions(body);
    return sendJson(res, 200, result);
  }

  if (pathname === '/api/orders' && req.method === 'POST') {
    const body = await readJson(req);
    if (!String(body.name || '').trim() || !String(body.phone || '').trim() || !String(body.story || '').trim()) {
      return sendJson(res, 400, { error: '필수 입력 항목이 빠졌습니다.' });
    }
    const order = await storage.createOrder(orderNumber => sanitizeNewOrder(body, orderNumber));
    void notifyNewOrder(order);
    return sendJson(res, 201, { storageId: order.storageId, id: order.id });
  }

  if (pathname === '/api/customer/lookup' && req.method === 'POST') {
    const body = await readJson(req, 64 * 1024);
    const number = String(body.orderNumber || '').trim().toLowerCase();
    const last4 = String(body.last4 || '').replace(/\D/g, '');
    const order = await storage.findCustomerOrder(number, last4);
    if (!order) return sendJson(res, 404, { error: 'not_found' });
    if (!order.customerVisible) return sendJson(res, 403, { error: 'not_visible' });
    const safe = { id: order.id, storageId: order.storageId, status: order.status, workType: order.workType, workSize: order.workSize,
      sentence: order.sentence, completedDate: order.completedDate, customerMessage: order.customerMessage,
      completedImage: order.completedImage, trackingNumber: order.trackingNumber };
    return sendJson(res, 200, safe);
  }

  if (pathname === '/api/gallery' && req.method === 'GET') {
    const rows = (await storage.listOrders()).filter(o => o.publicWork && o.completedImage).sort((a,b) => Number(Boolean(b.featuredWork)) - Number(Boolean(a.featuredWork)) || String(b.completedDate || b.createdAtIso || '').localeCompare(String(a.completedDate || a.createdAtIso || ''))).map(publicGalleryOrder);
    return sendJson(res, 200, rows);
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!demandAdmin(req, res)) return;
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      return sendJson(res, 200, await storage.listOrders());
    }
    if (pathname === '/api/admin/notification-status' && req.method === 'GET') {
      const config = await telegramConfig();
      return sendJson(res, 200, { configured: Boolean(config.token && config.chatId), telegram: { tokenSaved: Boolean(config.token), chatIdSaved: Boolean(config.chatId), chatId: config.chatId ? String(config.chatId) : '', source: config.source }, publicBaseUrl: PUBLIC_BASE_URL });
    }
    if (pathname === '/api/admin/telegram/connect' && req.method === 'POST') {
      const body = await readJson(req, 64 * 1024);
      const token = String(body.token || '').trim() || (await telegramConfig()).token;
      const me = await telegramApi(token, 'getMe');
      const updates = await telegramApi(token, 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message'] });
      const messages = Array.isArray(updates) ? updates.map(x => x && x.message).filter(Boolean) : [];
      const latest = messages.reverse().find(m => m.chat && (m.chat.type === 'private' || m.chat.type === 'group' || m.chat.type === 'supergroup'));
      if (!latest) return sendJson(res, 400, { error: '봇 대화방에서 /start 또는 아무 메시지를 한 번 보낸 뒤 다시 연결해 주세요.' });
      await storage.setSettings({ telegramBotToken: token, telegramChatId: String(latest.chat.id), telegramBotUsername: String(me.username || '') });
      return sendJson(res, 200, { ok: true, botUsername: me.username || '', chatId: String(latest.chat.id), chatName: latest.chat.first_name || latest.chat.title || '' });
    }
    if (pathname === '/api/admin/telegram/test' && req.method === 'POST') {
      const result = await sendTelegramMessage(`✅ 글결 텔레그램 알림 연결 성공\n\n이제 새 주문이 접수되면 이 대화방으로 알려드립니다.\n${PUBLIC_BASE_URL}`);
      if (!result.sent) return sendJson(res, 400, { error: '텔레그램 연결 정보가 없습니다. 먼저 봇 토큰을 연결해 주세요.' });
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/telegram/disconnect' && req.method === 'POST') {
      if (TELEGRAM_BOT_TOKEN_ENV || TELEGRAM_CHAT_ID_ENV) return sendJson(res, 400, { error: 'Railway 환경변수로 설정되어 있어 관리자 화면에서 해제할 수 없습니다.' });
      await storage.setSettings({ telegramBotToken: '', telegramChatId: '', telegramBotUsername: '' });
      return sendJson(res, 200, { ok: true });
    }
    if (pathname === '/api/admin/backup' && req.method === 'GET') {
      return sendJson(res, 200, { version: '8.3', exportedAt: new Date().toISOString(), orders: await storage.listOrders() });
    }
    if (pathname === '/api/admin/import' && req.method === 'POST') {
      const body = await readJson(req);
      if (!Array.isArray(body.orders)) return sendJson(res, 400, { error: 'orders 배열이 필요합니다.' });
      const imported = await storage.importOrders(body.orders);
      return sendJson(res, 200, { imported });
    }
    const match = pathname.match(/^\/api\/admin\/orders\/(\d+)$/);
    if (match && req.method === 'PUT') {
      const id = Number(match[1]);
      const body = await readJson(req);
      const current = await storage.getOrder(id);
      if (!current) return sendJson(res, 404, { error: 'not_found' });
      body.progressHistory = appendProgressHistory(current, body);
      const updated = await storage.updateOrder(id, body);
      if (!updated) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, updated);
    }
    if (match && req.method === 'DELETE') {
      const id = Number(match[1]);
      const deleted = await storage.deleteOrder(id);
      if (!deleted) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, { ok: true });
    }
  }
  return false;
}

function serveStatic(req, res, pathname) {
  // Ver7.10B: 관리자 화면 자체는 열어두고, 실제 주문 데이터 API는 Basic 인증으로 보호합니다.
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

async function start() {
  try {
    await storage.init();
    server.listen(PORT, HOST, () => {
      console.log(`글결 서버 실행: http://${HOST}:${PORT}`);
      console.log(`주문 저장소: ${storage.usePostgres ? 'PostgreSQL' : storage.dataFile}`);
      console.log(`AI 문구 추천: ${OPENAI_API_KEY ? OPENAI_MODEL : 'OPENAI_API_KEY 미설정'}`);
      console.log(`텔레그램 알림: ${TELEGRAM_BOT_TOKEN_ENV && TELEGRAM_CHAT_ID_ENV ? '환경변수 설정' : '관리자 화면에서 연결 가능'}`);
      if (!ADMIN_PASSWORD) console.warn('주의: Railway에 ADMIN_PASSWORD가 적용되지 않았습니다. Variables 변경 후 staged changes의 Deploy를 실행하세요.');
      else if (!IS_RAILWAY && ADMIN_PASSWORD === 'change-this-password') console.warn('주의: 로컬 기본 관리자 비밀번호를 사용 중입니다.');
    });
  } catch (error) {
    console.error('서버 시작 실패:', error);
    process.exit(1);
  }
}

start();
