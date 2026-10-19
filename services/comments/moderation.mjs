import { AccountError, signedIn } from './accounts.mjs';
const check = (ok, status, message) => { if (!ok) throw new AccountError(status, message); };
const columns = 'id, post, parent_id, reply_to, nickname, body, quote, anchor, role, ai_status, created_at, visible, deleted_at, deleted_group';
export async function administrator(request, env) {
  const user = await signedIn(request, env);
  check(user.role === 'admin', 403, '仅管理员可以管理评论。');
  return user;
}
export async function moderationRoute(request, env, url, data) {
  const user = await administrator(request, env);
  if (request.method === 'GET' && url.pathname === '/admin/comments') return list(url, env);
  check(request.method === 'POST', 405, '方法不支持。');
  check(data && typeof data === 'object', 400, '数据格式不正确。');
  let match;
  if ((match = /^\/admin\/comments\/([0-9a-z-]{1,80})\/delete$/i.exec(url.pathname))) return remove(env, user, match[1], null, data.scope);
  if (url.pathname === '/admin/comments/clear') {
    check(typeof data.post === 'string' && data.post.length > 0 && data.post.length <= 160, 400, '请选择要清空的文章。');
    return remove(env, user, null, data.post, 'post');
  }
  if ((match = /^\/admin\/actions\/([0-9a-f-]{36})\/restore$/i.exec(url.pathname))) return restore(env, user, match[1]);
  throw new AccountError(404, '接口不存在。');
}
async function list(url, env) {
  const post = url.searchParams.get('post') || '', view = url.searchParams.get('view') || 'active';
  check(post.length <= 160 && ['active', 'trash'].includes(view), 400, '筛选条件无效。');
  const before = Number(url.searchParams.get('before') || Number.MAX_SAFE_INTEGER), beforeId = url.searchParams.get('beforeId') || '\uffff';
  check(Number.isSafeInteger(before) && before > 0 && beforeId.length <= 80, 400, '分页参数无效。');
  const time = view === 'trash' ? 'deleted_at' : 'created_at';
  const where = view === 'trash' ? 'visible = 0 AND deleted_group IS NOT NULL' : 'visible = 1';
  const rows = await env.DB.prepare(`SELECT ${columns}, ${time} AS sort_at,
    (SELECT count(*) FROM comments related WHERE related.deleted_group = c.deleted_group AND related.visible = 0) AS deletion_size
    FROM comments c WHERE ${where} AND (? = '' OR post = ?) AND (${time} < ? OR (${time} = ? AND id < ?)) ORDER BY ${time} DESC, id DESC LIMIT 21`).bind(post, post, before, before, beforeId).all();
  const counts = await env.DB.prepare("SELECT COALESCE(SUM(visible = 1), 0) AS active, COALESCE(SUM(visible = 0 AND deleted_group IS NOT NULL), 0) AS trash FROM comments WHERE (? = '' OR post = ?)").bind(post, post).first();
  const posts = await env.DB.prepare('SELECT post, count(*) AS count FROM comments GROUP BY post ORDER BY post').all();
  const comments = rows.results.slice(0, 20), last = comments.at(-1);
  return { comments, counts, posts: posts.results, next: rows.results.length > 20 ? { before: last.sort_at, beforeId: last.id } : null };
}
async function remove(env, user, id, selectedPost, scope) {
  check(['entry', 'thread', 'post'].includes(scope), 400, '请选择删除范围。');
  let target, post = selectedPost, condition, parameters;
  if (scope === 'post') {
    condition = 'post = ?'; parameters = [post];
  } else {
    target = await env.DB.prepare('SELECT id, parent_id, post, visible FROM comments WHERE id = ?').bind(id).first();
    check(target, 404, '评论不存在。'); post = target.post;
    if (scope === 'thread' || !target.parent_id) {
      scope = 'thread'; id = target.parent_id || target.id;
      condition = '(id = ? OR parent_id = ?)'; parameters = [id, id];
    } else {
      condition = `id IN (WITH RECURSIVE branch(id) AS (SELECT id FROM comments WHERE id = ? UNION SELECT c.id FROM comments c JOIN branch b ON c.reply_to = b.id WHERE c.parent_id = ?) SELECT id FROM branch)`;
      parameters = [id, target.parent_id];
    }
  }
  const found = await env.DB.prepare(`SELECT id FROM comments WHERE visible = 1 AND ${condition} LIMIT 1`).bind(...parameters).first();
  if (!found) return { ok: true, affected: 0 };
  const actionId = crypto.randomUUID(), now = Date.now();
  // The group identifies precisely the visible records affected by this operation.
  const result = await env.DB.batch([
    env.DB.prepare('INSERT INTO moderation_actions(id, actor_id, scope, target_id, post, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(actionId, user.id, scope, id, post, now),
    env.DB.prepare(`UPDATE comments SET visible = 0, deleted_at = ?, deleted_group = ?, ai_status = CASE WHEN ai_status IN ('queued', 'working') THEN 'failed' ELSE ai_status END WHERE visible = 1 AND ${condition} RETURNING id`).bind(now, actionId, ...parameters),
    env.DB.prepare("UPDATE jobs SET status = 'cancelled', lease = NULL, lease_until = 0 WHERE status IN ('queued', 'working') AND comment_id IN (SELECT id FROM comments WHERE deleted_group = ?)").bind(actionId),
  ]);
  return { ok: true, actionId, affected: result[1].results.length };
}
async function restore(env, user, id) {
  const action = await env.DB.prepare('SELECT * FROM moderation_actions WHERE id = ?').bind(id).first();
  check(action, 404, '删除记录不存在。');
  if (action.restored_at) return { ok: true, affected: 0 };
  const blockedCondition = `FROM comments c LEFT JOIN comments root ON root.id = c.parent_id LEFT JOIN comments source ON source.id = c.reply_to
    WHERE c.deleted_group = ? AND ((root.visible = 0 AND COALESCE(root.deleted_group, '') != ?) OR (source.visible = 0 AND COALESCE(source.deleted_group, '') != ?))`;
  const blocked = await env.DB.prepare(`SELECT count(*) AS n ${blockedCondition}`).bind(id, id, id).first();
  check(!blocked.n, 409, '请先恢复上级评论或整条讨论，再恢复这条回复。');
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE comments SET visible = 1, deleted_at = NULL, deleted_group = NULL WHERE deleted_group = ? AND visible = 0
      AND NOT EXISTS (SELECT 1 ${blockedCondition}) RETURNING id`).bind(id, id, id, id),
    env.DB.prepare('UPDATE moderation_actions SET restored_at = ?, restored_by = ? WHERE id = ? AND restored_at IS NULL AND NOT EXISTS (SELECT 1 FROM comments WHERE deleted_group = ?)').bind(Date.now(), user.id, id, id),
  ]);
  check(result[0].results.length > 0, 409, '讨论状态已变化，请刷新后再恢复。');
  return { ok: true, affected: result[0].results.length };
}
