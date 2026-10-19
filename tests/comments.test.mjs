import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, writeFile, mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../services/comments/worker.mjs';
import { answerWithCodex, codexArguments, articleInstructions } from '../services/comments/responder.mjs';
import { contextFor, articleFor } from '../services/comments/context.mjs';

const schema = await readFile(new URL('../services/comments/migrations/0001_comments.sql', import.meta.url), 'utf8');
const token = 'test-worker-token-'.repeat(4);
const origin = 'https://vaying1112.github.io';
const originalFetch = globalThis.fetch;
globalThis.fetch = async input => {
  if (String(input).startsWith('https://article.test/')) return Response.json({ posts: [{ id: 'rope-complex', title: 'RoPE', body: '相对位置通过旋转后的点积进入注意力。' }, { id: 'other', title: '另一篇', body: '另一篇文章。' }] });
  return originalFetch(input);
};

class LocalD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec(schema); }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    let bindings = [];
    const prepared = {
      bind(...values) { bindings = values; return prepared; },
      async first() { return statement.get(...bindings) ?? null; },
      async all() { return { results: statement.all(...bindings) }; },
      async run() { return { meta: statement.run(...bindings) }; },
    };
    return prepared;
  }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const result = []; for (const statement of statements) result.push(await statement.all()); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
function env(extra = {}) { return { DB: new LocalD1(), WORKER_TOKEN: token, ALLOWED_ORIGINS: origin, ARTICLE_INDEX: 'https://article.test/' + crypto.randomUUID(), AI_DAILY_LIMIT: '20', ...extra }; }
async function request(e, path, data, internal = false, headers = {}) {
  const response = await worker.fetch(new Request('https://comments.test' + path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(internal ? { Authorization: `Bearer ${token}` } : { Origin: origin, 'CF-Connecting-IP': crypto.randomUUID() }), ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), e);
  return { status: response.status, data: await response.json(), response };
}
function comment(extra = {}) { return { id: crypto.randomUUID(), post: 'rope-complex', nickname: '读者', body: '为什么只依赖相对位置？', quote: '', anchor: '', askAI: true, ...extra }; }

test('quote, threaded reader replies and AI answer survive independent public reads', async () => {
  const e = env(); const root = comment({ quote: '相对位置', anchor: 'relative-position' });
  assert.equal((await request(e, '/comments', root)).status, 200);
  const followup = comment({ body: '能给一个数值例子吗？', replyTo: root.id, askAI: false });
  assert.equal((await request(e, '/comments', followup)).status, 200);
  const { data: { job } } = await request(e, '/internal/claim', {}, true);
  assert.equal(job.comment.quote, '相对位置'); assert.equal(job.article.title, 'RoPE');
  assert.equal((await request(e, `/internal/jobs/${root.id}/complete`, { lease: job.lease, body: '相位差为 $(n-m)\\omega$。' }, true)).status, 200);
  const { data } = await request(e, '/comments?post=rope-complex');
  assert.equal(data.total, 1); assert.equal(data.threads[0].anchor, 'relative-position');
  assert.equal(data.threads[0].replies.length, 2); assert.equal(data.threads[0].replies[1].role, 'ai');
  assert.equal(data.threads[0].ai_status, 'answered'); assert.equal(data.threads[0].replies[1].reply_to, root.id);
  assert.equal(JSON.stringify(data).includes(job.lease), false);
});

test('idempotent retries never enqueue or display duplicate comments', async () => {
  const e = env(); const input = comment();
  await request(e, '/comments', input);
  const again = await request(e, '/comments', input);
  assert.equal(again.status, 200); assert.equal(again.data.duplicate, true);
  assert.equal(e.DB.db.prepare('SELECT count(*) AS n FROM comments').get().n, 1);
  assert.equal(e.DB.db.prepare('SELECT count(*) AS n FROM jobs').get().n, 1);
  assert.equal((await request(e, '/comments', { ...input, body: '更换内容' })).status, 409);
});

test('article isolation and cross-article reply rejection', async () => {
  const e = env(); const root = comment(); await request(e, '/comments', root);
  assert.equal((await request(e, '/comments?post=other')).data.total, 0);
  assert.equal((await request(e, '/comments', comment({ post: 'other', replyTo: root.id }))).status, 404);
  assert.equal((await request(e, '/comments', comment({ post: 'private-draft' }))).status, 404);
});

test('untrusted callers cannot claim tasks, write AI replies, or choose the role', async () => {
  const e = env();
  assert.equal((await request(e, '/internal/claim', {}, false)).status, 401);
  assert.equal((await request(e, '/comments', comment(), false, { Origin: 'https://untrusted.test' })).status, 403);
  assert.equal((await request(e, '/comments', comment(), false, { Origin: '' })).status, 403);
  await request(e, '/comments', comment({ role: 'ai', ai_status: 'answered', askAI: false }));
  const { data } = await request(e, '/comments?post=rope-complex');
  assert.equal(data.threads[0].role, 'reader'); assert.equal(data.threads[0].ai_status, 'none');
});

test('input validation, honeypot, and SQL-like content', async () => {
  const e = env();
  for (const input of [comment({ nickname: '' }), comment({ body: 'a'.repeat(2001) }), comment({ quote: 'a'.repeat(601) }), comment({ askAI: 'yes' }), comment({ website: 'spam' }), comment({ id: 'invalid' })]) assert.equal((await request(e, '/comments', input)).status, 400);
  const malicious = "<img src=x onerror=alert(1)> '; DROP TABLE comments;--";
  assert.equal((await request(e, '/comments', comment({ body: malicious }))).status, 200);
  assert.equal((await request(e, '/comments?post=rope-complex')).data.threads[0].body, malicious);
});

test('one IP is limited to eight comments per ten minutes', async () => {
  const e = env();
  for (let i = 0; i < 8; i++) assert.equal((await request(e, '/comments', comment(), false, { 'CF-Connecting-IP': 'fixed-ip' })).status, 200);
  assert.equal((await request(e, '/comments', comment(), false, { 'CF-Connecting-IP': 'fixed-ip' })).status, 429);
  assert.equal(e.DB.db.prepare('SELECT count(*) AS n FROM comments').get().n, 8);
});

test('pagination has no missing or repeated root threads', async () => {
  const e = env();
  for (let i = 0; i < 13; i++) await request(e, '/comments', comment({ askAI: false }));
  const first = (await request(e, '/comments?post=rope-complex')).data;
  assert.equal(first.threads.length, 10); assert.equal(first.total, 13);
  const second = (await request(e, '/comments?post=rope-complex&' + new URLSearchParams(first.next))).data;
  assert.equal(second.threads.length, 3); assert.equal(second.next, null);
  assert.equal(new Set([...first.threads, ...second.threads].map(x => x.id)).size, 13);
});

test('leases prevent concurrent claims and stale writes; completion is idempotent', async () => {
  const e = env(); const input = comment(); await request(e, '/comments', input);
  const first = (await request(e, '/internal/claim', {}, true)).data.job;
  assert.equal((await request(e, '/internal/claim', {}, true)).data.job, null);
  e.DB.db.prepare('UPDATE jobs SET lease_until = 0').run();
  const replacement = (await request(e, '/internal/claim', {}, true)).data.job;
  assert.notEqual(first.lease, replacement.lease);
  assert.equal((await request(e, `/internal/jobs/${input.id}/complete`, { lease: first.lease, body: '旧结果' }, true)).status, 409);
  for (let i = 0; i < 2; i++) assert.equal((await request(e, `/internal/jobs/${input.id}/complete`, { lease: replacement.lease, body: '新结果' }, true)).status, 200);
  assert.equal((await request(e, '/comments?post=rope-complex')).data.threads[0].replies.length, 1);
});

test('daily limit stops new model calls without losing comments', async () => {
  const e = env({ AI_DAILY_LIMIT: '1' });
  await request(e, '/comments', comment()); await request(e, '/comments', comment());
  assert.ok((await request(e, '/internal/claim', {}, true)).data.job);
  assert.equal((await request(e, '/internal/claim', {}, true)).data.job, null);
  assert.equal((await request(e, '/comments?post=rope-complex')).data.total, 2);
  assert.equal(e.DB.db.prepare('SELECT used FROM quotas').get().used, 1);
});

test('bounded retries end in a visible failed status', async () => {
  const e = env(); const input = comment(); await request(e, '/comments', input);
  for (let i = 0; i < 3; i++) {
    const job = (await request(e, '/internal/claim', {}, true)).data.job;
    assert.ok(job);
    await request(e, `/internal/jobs/${input.id}/fail`, { lease: job.lease }, true);
    e.DB.db.prepare('UPDATE jobs SET available_at = 0').run();
  }
  assert.equal((await request(e, '/internal/claim', {}, true)).data.job, null);
  assert.equal((await request(e, '/comments?post=rope-complex')).data.threads[0].ai_status, 'failed');
});

test('hidden threads are not listed and cannot receive AI output', async () => {
  const e = env(); const input = comment(); await request(e, '/comments', input);
  const job = (await request(e, '/internal/claim', {}, true)).data.job;
  e.DB.db.prepare('UPDATE comments SET visible = 0 WHERE id = ?').run(input.id);
  await request(e, `/internal/jobs/${input.id}/complete`, { lease: job.lease, body: '不应展示' }, true);
  assert.equal((await request(e, '/comments?post=rope-complex')).data.total, 0);
  assert.equal(e.DB.db.prepare("SELECT count(*) AS n FROM comments WHERE role = 'ai'").get().n, 0);
});

test('third expired lease stops retrying and does not leave a permanently working comment', async () => {
  const e = env(); const input = comment(); await request(e, '/comments', input);
  for (let i = 0; i < 3; i++) {
    assert.ok((await request(e, '/internal/claim', {}, true)).data.job);
    e.DB.db.prepare('UPDATE jobs SET lease_until = 0').run();
  }
  assert.equal((await request(e, '/internal/claim', {}, true)).data.job, null);
  assert.equal((await request(e, '/comments?post=rope-complex')).data.threads[0].ai_status, 'failed');
});

test('oversized request streams are rejected before database writes', async () => {
  const e = env(); const result = await request(e, '/comments', comment({ body: 'x'.repeat(41000) }));
  assert.equal(result.status, 413);
  assert.equal(e.DB.db.prepare('SELECT count(*) AS n FROM comments').get().n, 0);
});

test('Codex adapter disables user configuration and tools', () => {
  const args = codexArguments('/tmp/isolated', '/tmp/output', '/tmp/schema');
  for (const flag of ['--ignore-user-config', '--ephemeral', 'read-only', 'features.shell_tool=false', 'features.plugins=false', 'features.apps=false', 'features.multi_agent=false']) assert.ok(args.includes(flag));
  assert.equal(args.some(arg => arg.includes(token)), false);
});

test('adapter separates the full stable article from visitor input and reports actual usage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fake-codex-'));
  const executable = join(directory, 'codex');
  await writeFile(executable, `#!/usr/bin/env node\nconst fs=require('node:fs');let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const context=JSON.parse(input);const fixed=process.argv.find(a=>a.startsWith('developer_instructions='));const instruction=JSON.parse(fixed.slice('developer_instructions='.length));const article=JSON.parse(instruction.split('\\n').at(-1));if(process.env.COMMENTS_WORKER_TOKEN||article.body!=='原文'||context.article||context.comment.body!=='问题')process.exit(2);fs.writeFileSync(process.argv[process.argv.indexOf('--output-last-message')+1],JSON.stringify({answer:'这是基于文章的解释。'}));console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:42,cached_input_tokens:20,output_tokens:10}}));});\n`);
  await chmod(executable, 0o700);
  process.env.COMMENTS_WORKER_TOKEN = token;
  let usage;
  try {
    const result = await answerWithCodex({ article: { title: 'RoPE', body: '原文' }, comment: { body: '问题', quote: '' }, history: [] }, { executable, workspace: join(directory, 'workspace'), onUsage: value => { usage = value; } });
    assert.equal(result, '这是基于文章的解释。');
    assert.equal(usage.inputTokens, 42); assert.equal(usage.cachedInputTokens, 20); assert.equal(usage.outputTokens, 10);
    assert.equal(usage.articleCharacters, 2);
  } finally { delete process.env.COMMENTS_WORKER_TOKEN; await rm(directory, { recursive: true, force: true }); }
});

const contextualJob = (comment = {}) => ({ article: { title: '旋转位置编码', body: '本文介绍位置编码。\n\n## 符号\n$m,n$ 是位置。\n\n## 矩阵与相对位置\n旋转后的点积保持共同平移不变。\n$$\nR(a)^T R(b)=R(b-a)\n$$\n\n## 多通道与频率\n频率使用几何尺度分布。\n\n## 训练\n学习投影参数。\n' }, comment: { body: '为什么共同平移后点积不变？', quote: '旋转后的点积保持共同平移不变。', ...comment }, history: [] });

test('same full article reuses a version; body or title changes invalidate it', () => {
  const { article } = contextualJob();
  const original = articleFor(article);
  assert.equal(articleFor({ ...article }), original);
  const changed = articleFor({ ...article, body: article.body + '\n更新后的论述。' });
  assert.notEqual(changed.version, original.version);
  assert.ok(changed.body.endsWith('更新后的论述。'));
  assert.notEqual(articleFor({ ...article, title: '新标题' }).version, original.version);
});

test('every question receives the complete article, including material beyond 50,000 characters', () => {
  for (const body of ['能再解释一下吗？', '总结全文中不同视角的联系。', '这里只解释选中的句子。']) {
    const job = contextualJob({ body });
    job.article.body += '完整正文不可裁切。'.repeat(10000) + '这是最后一句。';
    assert.equal(contextFor(job).article.body, job.article.body);
    assert.ok(contextFor(job).article.body.endsWith('这是最后一句。'));
  }
});

test('questions and history do not change the stable article prefix or contaminate other threads', () => {
  const first = contextualJob(); const second = contextualJob({ body: '另一个问题', quote: '另一句原文' });
  first.history = [{ role: 'reader', body: '线程 A 的私人测试内容' }];
  assert.equal(contextFor(first).article, contextFor(second).article);
  const prefix = articleInstructions(contextFor(first).article);
  assert.ok(prefix.includes(JSON.stringify(first.article.body)));
  assert.equal(prefix.includes('线程 A 的私人测试内容'), false);
  assert.equal(JSON.stringify(contextFor(second)).includes('线程 A 的私人测试内容'), false);
});

test('thread context is bounded, excludes nicknames, and sends the current question once', () => {
  const job = contextualJob();
  job.history = [...Array.from({ length: 13 }, (_, i) => ({ role: 'reader', body: '追问' + i, nickname: '非必要昵称' })), { role: 'reader', body: job.comment.body, quote: job.comment.quote }];
  const context = contextFor(job);
  assert.ok(context.history.length <= 12);
  assert.equal(context.history.some(item => item.body === job.comment.body), false);
  assert.equal(JSON.stringify(context).includes('非必要昵称'), false);
});
