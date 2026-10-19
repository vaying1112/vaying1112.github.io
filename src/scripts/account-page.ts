import { accountRequest, currentUser, saveToken, type User } from './account-client';
import { renderComment } from './render-comment';
const root = document.querySelector<HTMLElement>('[data-account]')!;
const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const form = get<HTMLFormElement>('[data-auth-form]');
const username = form.elements.namedItem('username') as HTMLInputElement;
const password = form.elements.namedItem('password') as HTMLInputElement;
const authSubmit = get<HTMLButtonElement>('[data-auth-submit]');
const posts: { id: string; title: string; url: string }[] = JSON.parse(root.dataset.posts!);
let mode = 'login', busy = false, next: { before: number; beforeId: string } | null = null;
let returnTo = '';
try { const destination = new URL(location.href).searchParams.get('return'); const url = new URL(destination || '/account/', location.origin); if (url.origin === location.origin && url.pathname.startsWith(import.meta.env.BASE_URL) && !url.pathname.includes('/account')) returnTo = url.pathname + url.search + url.hash; } catch {}
function message(value: string, error = false) { const el = get('[data-account-message]'); el.textContent = value; el.toggleAttribute('data-error', error); }
function setMode(value: string) {
  mode = value; form.reset(); password.autocomplete = mode === 'login' ? 'current-password' : 'new-password'; password.minLength = mode === 'login' ? 1 : 12;
  get('[data-recovery-field]').hidden = mode !== 'recover'; (form.elements.namedItem('recoveryCode') as HTMLInputElement).required = mode === 'recover';
  get('[data-register-hint]').hidden = mode === 'login'; get('[data-password-label]').textContent = mode === 'recover' ? '新密码' : '密码';
  authSubmit.textContent = { login: '登录', register: '创建账号', recover: '重设密码' }[mode]!;
  root.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String((button as HTMLElement).dataset.mode === mode)));
  get('[data-forgot]').hidden = mode === 'recover'; message('');
}
root.querySelectorAll<HTMLElement>('[data-mode]').forEach(button => button.addEventListener('click', () => { if (!busy) setMode(button.dataset.mode!); }));
get('[data-forgot]').addEventListener('click', () => setMode('recover'));
function element(tag: string, className: string, text = '') { const node = document.createElement(tag); node.className = className; node.textContent = text; return node; }
async function history(append = false) {
  const more = get<HTMLButtonElement>('[data-history-more]'); more.disabled = true;
  try {
    const query = new URLSearchParams(append && next ? { before: String(next.before), beforeId: next.beforeId } : {});
    const data = await accountRequest('/me/comments?' + query); next = data.next;
    const list = get('[data-history]'); if (!append) list.replaceChildren();
    for (const item of data.comments) {
      const article = posts.find(post => post.id === item.post);
      const card = element('article', 'history-entry'), meta = element('div', 'history-meta');
      const title = document.createElement('a'); title.textContent = article?.title || item.post; title.href = article?.url || import.meta.env.BASE_URL;
      const time = document.createElement('time'); time.dateTime = new Date(item.created_at).toISOString(); time.textContent = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(item.created_at);
      meta.append(title, time); card.append(meta);
      if (item.quote) card.append(element('blockquote', '', item.quote));
      card.append(renderComment(item.body));
      for (const answer of item.answers || []) { const details = document.createElement('details'); details.className = 'history-ai'; const summary = element('summary', '', 'AI 回复'); details.append(summary, renderComment(answer.body)); card.append(details); }
      const link = document.createElement('a'); link.className = 'history-link'; link.textContent = '查看讨论 ↗'; link.href = (article?.url || import.meta.env.BASE_URL) + '#comment-' + encodeURIComponent(item.id); card.append(link); list.append(card);
    }
    if (!list.childElementCount) list.append(element('p', 'history-empty', '还没有评论。到文章中写下第一个问题吧。'));
    more.hidden = !next;
  } catch (error) { message(error instanceof Error ? error.message : '评论加载失败。', true); }
  finally { more.disabled = false; }
}
async function showUser(user: User | null) {
  get('[data-auth-panel]').hidden = !!user; get('[data-signed-in]').hidden = !user;
  if (!user) { get('[data-history]').replaceChildren(); return; }
  get('[data-username]').textContent = user.username;
  if (returnTo) { const a = get<HTMLAnchorElement>('[data-return-link]'); a.href = returnTo; a.hidden = false; }
  await history();
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !form.reportValidity()) return; busy = true; authSubmit.disabled = true; message('正在处理…');
  try {
    const data = await accountRequest('/auth/' + mode, { username: username.value, password: password.value, recoveryCode: (form.elements.namedItem('recoveryCode') as HTMLInputElement).value });
    saveToken(data.token); form.reset(); message(''); await showUser(data.user);
    if (data.recoveryCode) { get('[data-recovery-code]').textContent = data.recoveryCode; get('[data-recovery-panel]').hidden = false; get('[data-signed-in]').hidden = true; }
    else if (returnTo) location.assign(returnTo);
  } catch (error) { message(error instanceof Error ? error.message : '操作失败。', true); }
  finally { busy = false; authSubmit.disabled = false; }
});
get('[data-copy-recovery]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(get('[data-recovery-code]').textContent || ''); message('找回码已复制。'); } catch { message('请选中找回码并手动复制。'); } });
get('[data-recovery-done]').addEventListener('click', () => { get('[data-recovery-code]').textContent = ''; get('[data-recovery-panel]').hidden = true; get('[data-signed-in]').hidden = false; if (returnTo) location.assign(returnTo); });
get('[data-logout]').addEventListener('click', async () => { try { await accountRequest('/auth/logout', {}); saveToken(''); await showUser(null); message('已退出登录。'); } catch (error) { message(error instanceof Error ? error.message : '退出失败。', true); } });
get('[data-history-more]').addEventListener('click', () => history(true));
const changeForm = get<HTMLFormElement>('[data-password-form]');
changeForm.addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !changeForm.reportValidity()) return; busy = true; const button = changeForm.querySelector<HTMLButtonElement>('button')!; button.disabled = true;
  try { await accountRequest('/auth/password', Object.fromEntries(new FormData(changeForm))); changeForm.reset(); saveToken(''); await showUser(null); message('密码已更新，请使用新密码登录。'); }
  catch (error) { message(error instanceof Error ? error.message : '修改失败。', true); }
  finally { busy = false; button.disabled = false; }
});
window.addEventListener('storage', event => { if (event.key === 'yifan-account-session') location.reload(); });
currentUser().then(showUser).catch(error => message(error.message, true));
