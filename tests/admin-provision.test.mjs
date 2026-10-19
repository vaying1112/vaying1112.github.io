import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
test('admin provisioning accepts Wrangler progress before JSON and keeps the private activation token out of terminal output and process arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blog-admin-provision-'));
  try {
    await mkdir(join(root, 'node_modules/.bin'), { recursive: true });
    await mkdir(join(root, 'services/comments'), { recursive: true });
    await writeFile(join(root, 'services/comments/wrangler.jsonc'), JSON.stringify({ vars: { ALLOWED_ORIGINS: 'https://example.github.io' } }));
    const mock = join(root, 'node_modules/.bin/wrangler');
    await writeFile(mock, `#!/usr/bin/env node
const fs = require('node:fs');
fs.appendFileSync('arguments.jsonl', JSON.stringify(process.argv.slice(2))+'\\n');
if (process.argv.includes('--file')) process.stdout.write('├ Checking if file needs uploading\\n├ Upload complete\\n'+JSON.stringify([{success:true,results:[]}]));
else process.stdout.write(JSON.stringify([{success:true,results:process.argv.join(' ').includes('SELECT user_id') ? [{user_id:'fixture'}] : []}]));
`); await chmod(mock, 0o700);
    const result = await exec(process.execPath, [new URL('../scripts/create-comment-admin.mjs', import.meta.url).pathname, '--username', 'owner_account', '--site-url', 'https://example.github.io/notes/'], { cwd: root });
    const activation = JSON.parse(await readFile(join(root, '.comments-local/admin-activation.json'), 'utf8'));
    assert.equal(activation.username, 'owner_account'); assert.match(activation.setupToken, /^[0-9a-f]{64}$/);
    assert.equal(new URL(activation.url).pathname, '/notes/admin/'); assert.equal(new URL(activation.url).hash, '#setup=' + activation.setupToken);
    assert.equal(result.stdout.includes(activation.setupToken), false);
    assert.equal((await readFile(join(root, 'arguments.jsonl'), 'utf8')).includes(activation.setupToken), false);
    assert.match(result.stdout, /尚未激活/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
