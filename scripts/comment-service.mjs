import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';

if (process.platform !== 'darwin') throw new Error('这个启动器用于 macOS；其他系统请使用 npm run comments:respond。');
const label = 'com.yifan-bookmarks.comment-responder';
const target = `gui/${process.getuid()}/${label}`;
const path = join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
const root = process.cwd();
function launch(...args) { return spawnSync('/bin/launchctl', args, { encoding: 'utf8' }); }
if (process.argv.includes('--remove')) {
  launch('bootout', target);
  await rm(path, { force: true }); console.log('已取消本机答疑自动启动；评论和历史仍保留。');
} else {
  const config = parseEnv(await readFile(resolve('.comments-local/responder.env'), 'utf8'));
  if (new URL(config.COMMENTS_API).protocol !== 'https:' || !config.COMMENTS_WORKER_TOKEN || config.COMMENTS_WORKER_TOKEN.length < 32) throw new Error('请先在 .comments-local/responder.env 配置正式 HTTPS 服务地址及凭证。');
  const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const args = [process.execPath, `--env-file=${resolve('.comments-local/responder.env')}`, resolve('scripts/comment-responder.mjs')];
  const binPath = [dirname(process.execPath), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');
  const log = resolve('.comments-local/responder.log');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array>${args.map(arg => `<string>${escape(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${escape(root)}</string>
<key>EnvironmentVariables</key><dict><key>PATH</key><string>${escape(binPath)}</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>
<key>StandardOutPath</key><string>${escape(log)}</string><key>StandardErrorPath</key><string>${escape(log)}</string>
</dict></plist>`;
  await mkdir(dirname(path), { recursive: true }); await mkdir(resolve('.comments-local'), { recursive: true, mode: 0o700 });
  launch('bootout', target);
  await writeFile(path, xml, { mode: 0o600 });
  const result = launch('bootstrap', `gui/${process.getuid()}`, path);
  if (result.status !== 0) throw new Error(result.stderr.trim() || '无法启动本机答疑服务。');
  console.log('已安装本机答疑服务：登录 macOS 后自动启动，后台串行处理评论。日志位于 .comments-local/responder.log。');
}
