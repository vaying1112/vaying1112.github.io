import { mkdir, open, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { answerWithCodex } from '../services/comments/responder.mjs';

const api = process.env.COMMENTS_API?.replace(/\/$/, '');
const token = process.env.COMMENTS_WORKER_TOKEN;
if (!api || !token || token.length < 32) throw new Error('请在 .comments-local/responder.env 配置 COMMENTS_API 和 COMMENTS_WORKER_TOKEN，见 docs/comments.md。');
const url = new URL(api);
if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('远程评论服务必须使用 HTTPS。');
const state = resolve('.comments-local');
await mkdir(state, { recursive: true, mode: 0o700 });
const lockPath = resolve(state, 'responder.lock');
const outboxPath = resolve(state, 'outbox.json');
try {
  const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); await lock.close();
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const prior = Number(await readFile(lockPath, 'utf8'));
  let alive = true;
  try { process.kill(prior, 0); } catch { alive = false; }
  if (alive) throw new Error('本机回答程序已经运行，请先停止已有进程。');
  await rm(lockPath); const lock = await open(lockPath, 'wx', 0o600); await lock.writeFile(String(process.pid)); await lock.close();
}
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });
async function call(path, data) {
  const response = await fetch(api + path, { method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}), signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || `HTTP ${response.status}`); error.status = response.status; throw error; }
  return result;
}
async function flush() {
  let saved;
  try { saved = JSON.parse(await readFile(outboxPath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  try { await call(`/internal/jobs/${saved.id}/complete`, { lease: saved.lease, body: saved.body }); }
  catch (error) { if (error.status !== 409) throw error; console.log('旧任务租约已过期，将由云端重新排队。'); }
  await rm(outboxPath, { force: true });
}
console.log('本机答疑程序已启动：串行领取任务，使用本机 Codex 登录，不开放本机端口。按 Ctrl+C 停止。');
try {
  while (!stopping) {
    try {
      await flush();
      if (stopping) break;
      const { job } = await call('/internal/claim');
      if (!job) { if (process.argv.includes('--once')) break; await pause(30000); continue; }
      console.log(`正在回答文章 ${job.comment.post} 的问题（${job.id}）。`);
      let body;
      try { body = await answerWithCodex(job, { model: process.env.COMMENTS_MODEL, executable: process.env.COMMENTS_CODEX_BIN || 'codex',
        onUsage: usage => console.log('上下文与用量：' + JSON.stringify(usage)) }); }
      catch (error) { await call(`/internal/jobs/${job.id}/fail`, { lease: job.lease }); throw error; }
      await writeFile(outboxPath, JSON.stringify({ id: job.id, lease: job.lease, body }), { mode: 0o600 });
      await flush(); console.log('回答已保存到讨论区。');
    } catch (error) {
      console.error(error.message);
      if ([401, 403].includes(error.status) || process.argv.includes('--once')) { process.exitCode = 1; break; }
      await pause(30000);
    }
    if (process.argv.includes('--once')) break;
  }
} finally { await rm(lockPath, { force: true }); }
