import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexArguments } from '../services/comments/responder.mjs';

// Exercise the real pinned CLI at its HTTP boundary. No account login, real model,
// or external network is used; fake auth and session data live in a temporary home.
test('native fork forwards question, quotation and history to the model without mixing threads', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-input-test-'));
  const cliTestHome = join(directory, 'codex-home');
  const executable = fileURLToPath(new URL('../node_modules/.bin/codex', import.meta.url));
  const article = { title: 'RoPE', body: 'COMPLETE_ARTICLE：两个向量共同旋转保持夹角与点积。' };
  const requests = [];
  await mkdir(cliTestHome);
  const schema = join(directory, 'schema.json');
  await writeFile(schema, JSON.stringify({ type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'], additionalProperties: false }));
  const server = createServer(async (request, response) => {
    if (request.headers.authorization !== 'Bearer input-test-placeholder') {
      response.writeHead(401); response.end(); return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body); requests.push(data);
    const lastUser = data.input.filter(item => item.role === 'user').at(-1);
    const text = lastUser?.content?.map(item => item.text || '').join('') || '';
    let input;
    try { input = JSON.parse(text); } catch { /* Template or the broken positional-prompt case. */ }
    const answer = input?.comment ? JSON.stringify(input) : 'NO_CURRENT_COMMENT';
    const item = { id: 'msg_local', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ answer }), annotations: [] }] };
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const event of [
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp_local', object: 'response', created_at: 1, status: 'completed', model: 'gpt-5.6', output: [item], usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } },
    ]) response.write('data: ' + JSON.stringify(event) + '\n\n');
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  async function run({ threadId, input, legacy = false }) {
    const output = join(directory, 'answer.json');
    const args = codexArguments(directory, output, schema, 'gpt-5.6', article, { threadId, persist: !threadId });
    args.splice(-1, 0,
      '-c', 'model_provider="input_test"',
      '-c', 'model_providers.input_test.name="local-input-test"',
      '-c', `model_providers.input_test.base_url="http://127.0.0.1:${server.address().port}/v1"`,
      '-c', 'model_providers.input_test.wire_api="responses"',
      '-c', 'model_providers.input_test.env_key="YIFAN_TEST_API_KEY"',
      '-c', 'model_providers.input_test.requires_openai_auth=false',
      '-c', 'model_providers.input_test.request_max_retries=0');
    if (legacy) args[args.length - 1] = '请回答输入 JSON 中的当前问题。';
    let createdId;
    await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { cwd: directory, env: { PATH: process.env.PATH, HOME: process.env.HOME, CODEX_HOME: cliTestHome, YIFAN_TEST_API_KEY: 'input-test-placeholder' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let events = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      child.on('error', reject);
      child.stderr.resume();
      child.stdout.on('data', chunk => { events += chunk; });
      child.on('close', code => {
        clearTimeout(timer);
        for (const line of events.split('\n')) try { const event = JSON.parse(line); if (event.type === 'thread.started') createdId = event.thread_id; } catch { /* Not an event. */ }
        if (code === 0) resolve(); else reject(new Error(`Local Codex input check exited ${code}`));
      });
      child.stdin.on('error', () => {});
      child.stdin.end(input ? JSON.stringify(input) : '');
    });
    return { id: createdId, answer: JSON.parse(await readFile(output, 'utf8')).answer };
  }
  try {
    const base = await run({});
    const inputA = { comment: { body: '详细一点：共同加 1 后怎样变化？', quote: '两条向量一起转，但夹角和分数不变。' }, history: [{ role: 'reader', body: 'THREAD_A_PREVIOUS_QUESTION' }] };
    const broken = await run({ threadId: base.id, input: inputA, legacy: true });
    assert.equal(broken.answer, 'NO_CURRENT_COMMENT', 'negative control reproduces the ignored stdin bug');
    const corrected = await run({ threadId: base.id, input: inputA });
    assert.deepEqual(JSON.parse(corrected.answer), inputA);
    const inputB = { comment: { body: '另一个讨论的问题', quote: '' }, history: [] };
    const isolated = await run({ threadId: base.id, input: inputB });
    assert.deepEqual(JSON.parse(isolated.answer), inputB);
    assert.equal(JSON.stringify(requests.at(-1).input).includes('THREAD_A_PREVIOUS_QUESTION'), false);
    assert.ok(requests.every(request => JSON.stringify(request.input).includes('COMPLETE_ARTICLE')));
    assert.ok(requests.every(request => request.prompt_cache_key === requests[0].prompt_cache_key));
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
