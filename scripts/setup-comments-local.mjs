import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

await mkdir('.comments-local', { recursive: true, mode: 0o700 });
let variables;
try { variables = parseEnv(await readFile('services/comments/.dev.vars', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const token = variables?.WORKER_TOKEN || randomBytes(32).toString('hex');
if (token.length < 32 || token.startsWith('replace-with-')) throw new Error('本地 WORKER_TOKEN 尚未配置，请移除示例值后重新运行设置。');
if (!variables) await writeFile('services/comments/.dev.vars', `WORKER_TOKEN=${token}\nARTICLE_INDEX=http://127.0.0.1:4321/comments-context.json\n`, { mode: 0o600, flag: 'wx' });
for (const [path, value] of [
  ['.env.local', 'PUBLIC_COMMENTS_API=http://127.0.0.1:8787\n'],
  ['.comments-local/responder.env', `COMMENTS_API=http://127.0.0.1:8787\nCOMMENTS_WORKER_TOKEN=${token}\n`],
  ['.comments-local/responder.local.env', `COMMENTS_API=http://127.0.0.1:8787\nCOMMENTS_WORKER_TOKEN=${token}\n`],
]) {
  try { await writeFile(path, value, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; console.log(`保留已有配置：${path}`); }
}
console.log('本地评论配置已准备好，凭证未输出。下一步运行 npm run comments:migrate:local。');
