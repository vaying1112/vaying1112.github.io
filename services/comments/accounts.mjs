import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';

export class AccountError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const check = (ok, status, message) => { if (!ok) throw new AccountError(status, message); };
export async function sha(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), x => x.toString(16).padStart(2, '0')).join('');
}
const random = bytes => randomBytes(bytes).toString('hex');
const normalize = value => typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
function username(value) {
  const name = normalize(value);
  check(/^[\p{L}\p{N}_]{3,24}$/u.test(name) && !['admin', 'administrator', 'root', 'ai', 'ai助手', '系统'].includes(name), 400, '用户名需为 3–24 位文字、数字或下划线。');
  return name;
}
function password(value) {
  check(typeof value === 'string' && [...value].length >= 12 && [...value].length <= 128, 400, '密码需为 12–128 位，可使用一段容易记住的句子。');
  return value;
}
// OWASP scrypt configuration: 16 MiB, N=2^14, r=8, p=5. Never store the input password.
function derive(value, salt) {
  return new Promise((resolve, reject) => scrypt(value, salt, 32, { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
}
async function hashPassword(value) {
  const salt = random(16);
  return `scrypt:16384:8:5:${salt}:${(await derive(value, salt)).toString('hex')}`;
}
async function verifyPassword(value, stored) {
  const [, n, r, p, salt, expected] = stored.split(':');
  if (n !== '16384' || r !== '8' || p !== '5' || !/^[0-9a-f]{64}$/.test(expected || '')) return false;
  const actual = await derive(value, salt);
  return timingSafeEqual(actual, Uint8Array.from(expected.match(/../g), x => parseInt(x, 16)));
}
async function throttle(env, purpose, subject, limit, window) {
  const now = Date.now();
  const key = await sha(`${env.WORKER_TOKEN}:auth:${purpose}:${Math.floor(now / window)}:${subject}`);
  const row = await env.DB.prepare('INSERT INTO rate_limits(key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(key, now + window).first();
  check(row.count <= limit, 429, '尝试过于频繁，请稍后再试。');
  await env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now).run();
}
export async function signedIn(request, env) {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(request.headers.get('authorization') || '')?.[1];
  check(token, 401, '请先登录后发表评论。');
  const user = await env.DB.prepare('SELECT u.id, u.username, u.created_at, u.role, s.token_hash, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.activated = 1').bind(await sha(token), Date.now()).first();
  check(user, 401, '登录已过期，请重新登录。');
  return user;
}
const profile = user => ({ id: user.id, username: user.username, created_at: user.created_at, role: user.role || 'reader' });
async function session(env, user) {
  const token = random(32), now = Date.now(), expires_at = now + 30 * 86400000;
  const created = await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    env.DB.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) SELECT ?, id, ? FROM users WHERE id = ? AND password_hash = ? AND activated = 1 RETURNING token_hash').bind(await sha(token), expires_at, user.id, user.password_hash),
  ]);
  check(created[1].results.length, 401, '密码已变更，请重新登录。');
  return { token, expires_at, user: profile(user) };
}
export async function accountRoute(request, env, path, data) {
  if (path === '/me' && request.method === 'GET') return { user: profile(await signedIn(request, env)) };
  check(request.method === 'POST', 405, '方法不支持。');
  check(data && typeof data === 'object' && !data.website, 400, '数据格式不正确。');
  if (path === '/auth/logout') {
    const user = await signedIn(request, env);
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.token_hash).run();
    return { ok: true };
  }
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  await throttle(env, 'ip', ip, 20, 900000);
  if (path === '/auth/admin-setup-info' || path === '/auth/admin-setup') return activateAdmin(env, data, path.endsWith('-info'));
  if (path === '/auth/password') {
    const user = await signedIn(request, env);
    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(user.id).first();
    check(typeof data.currentPassword === 'string' && data.currentPassword.length <= 256 && await verifyPassword(data.currentPassword, row.password_hash), 401, '当前密码不正确。');
    const next = await hashPassword(password(data.password));
    await env.DB.batch([env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?').bind(next, user.id, row.password_hash), env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)]);
    return { ok: true };
  }
  check(['/auth/register', '/auth/login', '/auth/recover'].includes(path), 404, '接口不存在。');
  const name = username(data.username);
  await throttle(env, 'name', name, 10, 900000);
  const row = await env.DB.prepare('SELECT * FROM users WHERE username = ?').bind(name).first();
  if (path === '/auth/register') {
    await throttle(env, 'register', ip, 5, 3600000);
    check(!row, 409, '此用户名已被注册。');
    const user = { id: crypto.randomUUID(), username: name, created_at: Date.now() };
    const hash = await hashPassword(password(data.password));
    user.password_hash = hash;
    const recovery = random(16);
    try {
      await env.DB.prepare('INSERT INTO users(id, username, password_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?)').bind(user.id, name, hash, await sha(recovery), user.created_at).run();
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) throw new AccountError(409, '此用户名已被注册。');
      throw error;
    }
    return { ...await session(env, user), recoveryCode: recovery };
  }
  if (path === '/auth/login') {
    check(typeof data.password === 'string' && data.password.length <= 256, 400, '密码格式不正确。');
    // A dummy derivation makes missing accounts take the same expensive path.
    const valid = await verifyPassword(data.password, row?.password_hash || 'scrypt:16384:8:5:00000000000000000000000000000000:' + '0'.repeat(64));
    check(row && row.activated === 1 && valid, 401, '用户名或密码不正确。');
    return session(env, row);
  }
  check(typeof data.recoveryCode === 'string' && data.recoveryCode.length <= 100, 400, '请填写找回码。');
  const recoveryHash = await sha(data.recoveryCode.trim().replace(/\s|-/g, '').toLowerCase());
  check(row && row.activated === 1 && timingSafeEqual(new TextEncoder().encode(recoveryHash), new TextEncoder().encode(row.recovery_hash)), 401, '用户名或找回码不正确。');
  const next = await hashPassword(password(data.password)), recovery = random(16);
  const result = await env.DB.batch([
    env.DB.prepare('UPDATE users SET password_hash = ?, recovery_hash = ? WHERE id = ? AND recovery_hash = ? RETURNING id').bind(next, await sha(recovery), row.id, recoveryHash),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.id),
  ]);
  check(result[0].results.length, 409, '找回码已使用，请使用新的找回码。');
  return { ...await session(env, { ...row, password_hash: next }), recoveryCode: recovery };
}

async function activateAdmin(env, data, infoOnly) {
  check(typeof data.setupToken === 'string' && /^[0-9a-f]{64}$/.test(data.setupToken), 401, '激活链接无效、已使用或已过期。');
  const tokenHash = await sha(data.setupToken), now = Date.now();
  const user = await env.DB.prepare("SELECT u.id, u.username, u.role, u.created_at FROM admin_setup i JOIN users u ON u.id = i.user_id WHERE i.token_hash = ? AND i.used_at IS NULL AND i.expires_at > ? AND u.role = 'admin' AND u.activated = 0").bind(tokenHash, now).first();
  check(user, 401, '激活链接无效、已使用或已过期，请使用已有账号登录。');
  if (infoOnly) return { username: user.username };
  const passwordHash = await hashPassword(password(data.password)), recoveryCode = random(16);
  const result = await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?, recovery_hash = ?, activated = 1 WHERE id = ? AND role = 'admin' AND activated = 0 AND EXISTS (SELECT 1 FROM admin_setup WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?) RETURNING id").bind(passwordHash, await sha(recoveryCode), user.id, tokenHash, Date.now()),
    env.DB.prepare('UPDATE admin_setup SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash = ?)').bind(Date.now(), tokenHash, user.id, passwordHash),
  ]);
  check(result[0].results.length, 409, '此激活链接已使用，请登录管理员账号。');
  return { ...await session(env, { ...user, password_hash: passwordHash }), recoveryCode };
}
