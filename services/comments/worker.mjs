const encoder = new TextEncoder();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const columns = 'id, post, parent_id, reply_to, nickname, body, quote, anchor, role, ai_status, created_at';
let articleCache;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function requireValue(condition, status, message) { if (!condition) throw new HttpError(status, message); }
function text(value, max, name, optional = false) {
  requireValue(typeof value === 'string', 400, `${name}格式不正确。`);
  const result = value.trim();
  requireValue((optional || result.length > 0) && result.length <= max, 400, `${name}长度不合适（最多 ${max} 字）。`);
  return result;
}
async function jsonBody(request) {
  requireValue(request.headers.get('content-type')?.includes('application/json'), 415, '请提交 JSON 数据。');
  requireValue(Number(request.headers.get('content-length') || 0) <= 40000, 413, '内容太长，请缩短后重试。');
  const reader = request.body?.getReader();
  requireValue(reader, 400, '请填写内容。');
  const chunks = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 40000) { await reader.cancel(); throw new HttpError(413, '内容太长，请缩短后重试。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, '数据格式不正确。'); }
}
async function digest(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
async function authenticate(request, env) {
  requireValue(typeof env.WORKER_TOKEN === 'string' && env.WORKER_TOKEN.length >= 32, 503, '服务尚未配置。');
  const a = await digest(request.headers.get('authorization') || '');
  const b = await digest(`Bearer ${env.WORKER_TOKEN}`);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  requireValue(difference === 0, 401, '未授权。');
}
async function article(env, id) {
  if (!articleCache || articleCache.url !== env.ARTICLE_INDEX || articleCache.until < Date.now()) {
    const response = await fetch(env.ARTICLE_INDEX, { signal: AbortSignal.timeout(12000) });
    requireValue(response.ok, 503, '暂时无法核对文章，请稍后重试。');
    const data = await response.json();
    requireValue(Array.isArray(data.posts), 503, '文章索引不可用。');
    articleCache = { url: env.ARTICLE_INDEX, posts: data.posts, until: Date.now() + 60000 };
  }
  const result = articleCache.posts.find(post => post.id === id);
  requireValue(result && typeof result.body === 'string', 404, '这篇文章尚未开放评论。');
  return result;
}
async function rateLimit(request, env, now) {
  requireValue(env.WORKER_TOKEN?.length >= 32, 503, '服务尚未配置。');
  const window = Math.floor(now / 600000);
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  const key = await digest(`${env.WORKER_TOKEN}:${window}:${ip}`);
  const result = await env.DB.prepare('INSERT INTO rate_limits(key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(key, now + 600000).first();
  requireValue(result.count <= 8, 429, '评论过于频繁，请十分钟后再试。');
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run();
}
async function listComments(url, env) {
  const post = text(url.searchParams.get('post'), 160, '文章');
  const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER);
  const beforeId = url.searchParams.get('beforeId') || '\uffff';
  requireValue(Number.isSafeInteger(before) && before > 0 && beforeId.length <= 80, 400, '分页参数无效。');
  const rows = await env.DB.prepare(`SELECT ${columns} FROM comments WHERE post = ? AND parent_id IS NULL AND visible = 1 AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT 11`).bind(post, before, before, beforeId).all();
  const roots = rows.results.slice(0, 10);
  let replies = [];
  if (roots.length) {
    const result = await env.DB.prepare(`SELECT ${columns} FROM comments WHERE visible = 1 AND parent_id IN (${roots.map(() => '?').join(',')}) ORDER BY created_at, id`).bind(...roots.map(row => row.id)).all();
    replies = result.results;
  }
  const total = await env.DB.prepare('SELECT count(*) AS count FROM comments WHERE post = ? AND parent_id IS NULL AND visible = 1').bind(post).first();
  const last = roots.at(-1);
  return { threads: roots.map(root => ({ ...root, replies: replies.filter(reply => reply.parent_id === root.id) })), total: total.count, next: rows.results.length > 10 ? { before: last.created_at, beforeId: last.id } : null };
}
async function createComment(request, env) {
  const data = await jsonBody(request);
  requireValue(data && typeof data === 'object', 400, '评论格式不正确。');
  requireValue(!data.website, 400, '无法提交评论。');
  const id = text(data.id, 36, '提交标识');
  requireValue(uuid.test(id), 400, '提交标识无效。');
  const post = text(data.post, 160, '文章');
  const nickname = text(data.nickname, 30, '昵称');
  const body = text(data.body, 2000, '评论');
  const quote = text(data.quote ?? '', 600, '引用', true);
  const anchor = text(data.anchor ?? '', 180, '引用位置', true);
  const replyTo = data.replyTo ? text(data.replyTo, 80, '回复对象') : null;
  requireValue(typeof data.askAI === 'boolean', 400, '请选择是否需要 AI 回复。');
  const prior = await env.DB.prepare('SELECT id, post, nickname, body, reply_to, quote, anchor FROM comments WHERE id = ?').bind(id).first();
  if (prior) {
    requireValue(prior.post === post && prior.nickname === nickname && prior.body === body && prior.reply_to === replyTo && prior.quote === quote && prior.anchor === anchor, 409, '提交内容已改变，请重新提交。');
    return { id, duplicate: true };
  }
  await article(env, post);
  const now = Date.now();
  await rateLimit(request, env, now);
  let parent = null;
  if (replyTo) {
    const target = await env.DB.prepare('SELECT id, parent_id, post, visible FROM comments WHERE id = ?').bind(replyTo).first();
    requireValue(target && target.visible && target.post === post, 404, '回复对象已不存在。');
    parent = target.parent_id || target.id;
    const root = await env.DB.prepare('SELECT visible FROM comments WHERE id = ?').bind(parent).first();
    requireValue(root?.visible, 404, '讨论已关闭。');
    const size = await env.DB.prepare('SELECT count(*) AS count FROM comments WHERE parent_id = ?').bind(parent).first();
    requireValue(size.count < 80, 400, '这个讨论较长，请新建一条评论。');
  }
  const statements = [env.DB.prepare('INSERT INTO comments(id, post, parent_id, reply_to, nickname, body, quote, anchor, ai_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, post, parent, replyTo, nickname, body, quote, anchor, data.askAI ? 'queued' : 'none', now)];
  if (data.askAI) statements.push(env.DB.prepare('INSERT INTO jobs(comment_id, created_at) VALUES (?, ?)').bind(id, now));
  await env.DB.batch(statements);
  return { id };
}
async function claimJob(env) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const limit = Math.max(0, Math.min(200, Number(env.AI_DAILY_LIMIT ?? 20) || 0));
  const lease = crypto.randomUUID();
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE jobs SET status = 'working', lease = ?, lease_until = ?, attempts = attempts + 1 WHERE comment_id = (
      SELECT j.comment_id FROM jobs j JOIN comments c ON c.id = j.comment_id
      WHERE (j.status = 'queued' OR (j.status = 'working' AND j.lease_until < ?)) AND j.available_at <= ? AND j.attempts < 3 AND c.visible = 1
      AND (c.parent_id IS NULL OR EXISTS (SELECT 1 FROM comments root WHERE root.id = c.parent_id AND root.visible = 1))
      AND COALESCE((SELECT used FROM quotas WHERE day = ?), 0) < ? ORDER BY j.created_at LIMIT 1
    ) RETURNING comment_id`).bind(lease, now + 600000, now, now, day, limit),
    env.DB.prepare('INSERT INTO quotas(day, used) SELECT ?, 1 WHERE EXISTS (SELECT 1 FROM jobs WHERE lease = ?) ON CONFLICT(day) DO UPDATE SET used = used + 1').bind(day, lease),
    env.DB.prepare("UPDATE comments SET ai_status = 'working' WHERE id = (SELECT comment_id FROM jobs WHERE lease = ?)").bind(lease),
    env.DB.prepare("UPDATE comments SET ai_status = 'failed' WHERE id IN (SELECT comment_id FROM jobs WHERE (status = 'queued' OR (status = 'working' AND lease_until < ?)) AND attempts >= 3)").bind(now),
    env.DB.prepare("UPDATE jobs SET status = 'failed' WHERE (status = 'queued' OR (status = 'working' AND lease_until < ?)) AND attempts >= 3").bind(now),
  ]);
  if (!result[0].results.length) return { job: null };
  const comment = await env.DB.prepare(`SELECT ${columns} FROM comments WHERE id = ?`).bind(result[0].results[0].comment_id).first();
  const root = comment.parent_id || comment.id;
  const history = await env.DB.prepare(`SELECT nickname, body, quote, role FROM comments WHERE (id = ? OR parent_id = ?) AND visible = 1 AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 12`).bind(root, root, comment.created_at).all();
  try {
    const source = await article(env, comment.post);
    return { job: { id: comment.id, lease, comment, history: history.results.reverse(), article: source } };
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare("UPDATE jobs SET status = 'queued', lease = NULL, available_at = ? WHERE lease = ?").bind(now + 60000, lease),
      env.DB.prepare("UPDATE comments SET ai_status = 'queued' WHERE id = ?").bind(comment.id),
    ]);
    throw error;
  }
}
async function finishJob(id, data, env, failed) {
  const now = Date.now();
  const lease = text(data.lease, 36, '任务租约');
  const job = await env.DB.prepare("SELECT j.*, c.parent_id, c.post, c.visible FROM jobs j JOIN comments c ON c.id = j.comment_id WHERE j.comment_id = ? AND j.lease = ? AND j.status = 'working' AND j.lease_until > ?").bind(id, lease, now).first();
  if (!job) {
    const done = await env.DB.prepare("SELECT status, lease FROM jobs WHERE comment_id = ?").bind(id).first();
    if (!failed && done?.status === 'done' && done.lease === lease) return { ok: true };
    throw new HttpError(409, '任务租约已过期。');
  }
  if (failed) {
    const status = job.attempts >= 3 ? 'failed' : 'queued';
    await env.DB.batch([
      env.DB.prepare('UPDATE jobs SET status = ?, available_at = ?, lease = NULL WHERE comment_id = ? AND lease = ?').bind(status, now + 60000 * job.attempts, id, lease),
      env.DB.prepare('UPDATE comments SET ai_status = ? WHERE id = ?').bind(status, id),
    ]);
  } else {
    const body = text(data.body, 8000, '回答');
    const parent = job.parent_id || id;
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO comments(id, post, parent_id, reply_to, nickname, body, role, created_at, visible)
        SELECT ?, ?, ?, ?, 'AI 助手', ?, 'ai', ?, 1 WHERE EXISTS (SELECT 1 FROM jobs WHERE comment_id = ? AND lease = ? AND status = 'working' AND lease_until > ?)
        AND EXISTS (SELECT 1 FROM comments WHERE id = ? AND visible = 1) AND EXISTS (SELECT 1 FROM comments WHERE id = ? AND visible = 1)
        ON CONFLICT(id) DO NOTHING`).bind(`ai-${id}`, job.post, parent, id, body, now, id, lease, now, id, parent),
      env.DB.prepare("UPDATE jobs SET status = 'done' WHERE comment_id = ? AND lease = ? AND status = 'working'").bind(id, lease),
      env.DB.prepare("UPDATE comments SET ai_status = 'answered' WHERE id = ?").bind(id),
    ]);
  }
  return { ok: true };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim());
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (origin && allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
    try {
      requireValue(!origin || allowed.includes(origin), 403, '此来源不可访问评论服务。');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' } });
      const url = new URL(request.url);
      let data;
      if (url.pathname.startsWith('/internal/')) {
        await authenticate(request, env);
        requireValue(request.method === 'POST', 405, '方法不支持。');
        if (url.pathname === '/internal/claim') data = await claimJob(env);
        else {
          const match = /^\/internal\/jobs\/([0-9a-f-]{36})\/(complete|fail)$/.exec(url.pathname);
          requireValue(match, 404, '接口不存在。');
          data = await finishJob(match[1], await jsonBody(request), env, match[2] === 'fail');
        }
      } else if (url.pathname === '/comments' && request.method === 'GET') data = await listComments(url, env);
      else if (url.pathname === '/comments' && request.method === 'POST') {
        requireValue(origin && allowed.includes(origin), 403, '请从博客提交评论。');
        data = await createComment(request, env);
      } else if (url.pathname === '/health' && request.method === 'GET') data = { ok: true };
      else throw new HttpError(404, '接口不存在。');
      return Response.json(data, { headers });
    } catch (error) {
      if (!(error instanceof HttpError)) console.error('comments service failed:', error.name);
      return Response.json({ error: error instanceof HttpError ? error.message : '评论服务暂时不可用，请稍后重试。' }, { status: error instanceof HttpError ? error.status : 503, headers });
    }
  },
};
