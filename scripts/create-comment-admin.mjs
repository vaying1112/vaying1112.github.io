import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const local = process.argv.includes('--local');
const index = process.argv.indexOf('--username');
const username = (index < 0 ? 'yifan_admin' : process.argv[index + 1] || '').normalize('NFKC').toLowerCase();
if (!/^[a-z0-9_]{3,24}$/.test(username)) throw new Error('请指定 3–24 位小写字母、数字或下划线用户名。');
const config = `services/comments/wrangler${local ? '.local' : ''}.jsonc`;
const base = ['d1', 'execute', 'yifan-comments', local ? '--local' : '--remote', '--config', config];
function parseResult(output) {
  // Remote file imports can emit progress before the JSON array even with --json.
  const start = output.search(/^\s*\[/m);
  if (start < 0) throw new Error('数据库未返回可核对的结果。');
  return JSON.parse(output.slice(start));
}
function query(sql) {
  const rows = parseResult(execFileSync(resolve('node_modules/.bin/wrangler'), [...base, '--command', sql, '--json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
  if (rows.some(row => !row.success)) throw new Error('数据库操作未完成。'); return rows;
}
const quote = text => "'" + String(text).replaceAll("'", "''") + "'";
const existing = query(`SELECT id, role, activated FROM users WHERE username = ${quote(username)}`)[0].results[0];
if (existing && (existing.role !== 'admin' || existing.activated)) throw new Error('此用户名已被使用；不会修改已有账号或覆盖密码。请指定其他用户名。');
const token = randomBytes(32).toString('hex'), hash = createHash('sha256').update(token).digest('hex');
const now = Date.now(), expiresAt = now + 86400000, id = existing?.id || randomUUID();
await mkdir('.comments-local', { recursive: true, mode: 0o700 });
const sql = `INSERT INTO users(id, username, password_hash, recovery_hash, created_at, role, activated) VALUES (${quote(id)}, ${quote(username)}, 'pending', ${quote(createHash('sha256').update(randomBytes(32)).digest('hex'))}, ${now}, 'admin', 0) ON CONFLICT(username) DO NOTHING;
DELETE FROM admin_setup WHERE user_id = ${quote(id)} AND EXISTS (SELECT 1 FROM users WHERE id = ${quote(id)} AND role = 'admin' AND activated = 0);
INSERT INTO admin_setup(token_hash, user_id, expires_at) SELECT ${quote(hash)}, id, ${expiresAt} FROM users WHERE id = ${quote(id)} AND role = 'admin' AND activated = 0;`;
// Do not place the activation token or its hash in process arguments or terminal output.
const sqlPath = `.comments-local/admin-provision${local ? '.local' : ''}.sql`;
await writeFile(sqlPath, sql, { mode: 0o600 });
const result = parseResult(execFileSync(resolve('node_modules/.bin/wrangler'), [...base, '--file', sqlPath, '--json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
if (result.some(row => !row.success)) throw new Error('管理员预建未完成。');
if (!query(`SELECT user_id FROM admin_setup WHERE user_id = ${quote(id)} AND used_at IS NULL`)[0].results.length) throw new Error('用户名已被使用，请重新运行并指定其他用户名。');
const siteIndex = process.argv.indexOf('--site-url');
const settings = JSON.parse(await readFile(config, 'utf8'));
const site = new URL(siteIndex < 0 ? settings.vars.ALLOWED_ORIGINS.split(',')[0] + '/' : process.argv[siteIndex + 1]);
if (!local && site.protocol !== 'https:') throw new Error('正式站激活地址必须使用 HTTPS。');
if (!site.pathname.endsWith('/')) site.pathname += '/';
const activation = new URL('admin/', site); activation.hash = 'setup=' + token;
const path = `.comments-local/admin-activation${local ? '.local' : ''}.json`;
await writeFile(path, JSON.stringify({ username, userId: id, expiresAt, url: activation.href, setupToken: token }, null, 2), { mode: 0o600 });
console.log(`管理员 ${username} 已预建，尚未激活。私密激活链接保存于 ${path}，24 小时有效；请在网页自行设置密码。`);
