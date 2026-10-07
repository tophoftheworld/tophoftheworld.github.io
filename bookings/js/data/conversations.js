/* Read-only chat history from the leads dashboard API (GET /api/conversations/:id). */

const FIREBASE_API_BASE = 'https://matchanese-attendance.web.app/api';
const LOOKBACK_DAYS = 90;
const cache = new Map();
let sameOriginMissing = false;

/** Same-origin API first where the hub dev server or Firebase hosting serves it, then production. */
function apiBases() {
  const { hostname, port, origin } = window.location;
  const local = (hostname === 'localhost' || hostname === '127.0.0.1') && ['8080', '5000', '8788'].includes(port);
  const hosted = hostname === 'matchanese-attendance.web.app' || hostname === 'matchanese-attendance.firebaseapp.com';
  return (local || hosted) && !sameOriginMissing ? [`${origin}/api`, FIREBASE_API_BASE] : [FIREBASE_API_BASE];
}

function authHeaders() {
  const token = window.CHATBASE_DASHBOARD_CONFIG?.ADMIN_API_TOKEN || '';
  return token ? { 'x-admin-token': token } : {};
}

/** Returns { res, body }; skips a base that answers without JSON (a plain static server, not the API). */
async function apiFetch(path, init) {
  const bases = apiBases();
  let lastError = null;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${path}`, init);
      const isJson = (res.headers.get('content-type') || '').includes('application/json');
      if (!isJson && base !== bases[bases.length - 1]) {
        sameOriginMissing = true;
        continue;
      }
      const body = isJson ? await res.json().catch(() => ({})) : {};
      return { res, body };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Chat service unreachable');
}

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

/** The API searches a date window; widen it back to the lead's creation date. */
function lookupWindow(createdAt) {
  const now = new Date();
  const start = new Date(now.getTime() - LOOKBACK_DAYS * 86400e3);
  const created = createdAt ? new Date(createdAt) : null;
  if (created && !Number.isNaN(created.getTime())) {
    const fromCreated = new Date(created.getTime() - 7 * 86400e3);
    if (fromCreated < start) return { startDate: ymd(fromCreated), endDate: ymd(now) };
  }
  return { startDate: ymd(start), endDate: ymd(now) };
}

function shapeMessages(conversation) {
  return (conversation?.messages || [])
    .filter((m) => m && String(m.content || '').trim())
    .map((m) => ({
      from: m.role === 'assistant' ? 'bot' : 'client',
      at: m.createdAt || conversation.createdAt || null,
      text: String(m.content)
    }));
}

/** Finds the inbox thread where the bot shared this quote reference; null when none matches. */
export async function resolveConversationId({ quoteReference, createdAt, updatedAt }) {
  if (!quoteReference) return null;
  const { res, body } = await apiFetch('/conversations/resolve/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ quoteReference, loggedAt: updatedAt || createdAt, anchorDate: createdAt || updatedAt }),
    signal: AbortSignal.timeout(60000)
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(body.message || `Chat lookup failed (${res.status})`);
  return body.conversationId || null;
}

/** @returns {Promise<{ from: 'client'|'bot', at: string|null, text: string }[]>} */
export function loadConversation(conversationId, { createdAt } = {}) {
  if (!conversationId) return Promise.resolve([]);
  if (cache.has(conversationId)) return cache.get(conversationId);
  const params = new URLSearchParams({ ...lookupWindow(createdAt), maxPages: '100' });
  const promise = apiFetch(`/conversations/${encodeURIComponent(conversationId)}?${params}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(45000)
  })
    .then(({ res, body }) => {
      if (!res.ok) throw new Error(body.message || `Chat lookup failed (${res.status})`);
      return shapeMessages(body.data);
    })
    .catch((err) => {
      cache.delete(conversationId);
      throw err;
    });
  cache.set(conversationId, promise);
  return promise;
}

export function inboxUrl(conversationId) {
  return `../chatbase-leads-dashboard/public/index.html?id=${encodeURIComponent(conversationId)}`;
}
