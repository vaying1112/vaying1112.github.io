import { accountRequest, currentUser, saveToken, type User } from './account-client';
import { bindPasswordConfirmation } from './password-confirmation';
import { renderComment } from './render-comment';
interface Entry { id: string; post: string; nickname: string; body: string; quote: string; role: string; parent_id: string | null; created_at: number; deleted_at: number | null; deleted_group: string | null; deletion_size: number; }
interface Page { comments: Entry[]; counts: { active: number; trash: number }; posts: { post: string }[]; next: { before: number; beforeId: string } | null; }
const root = document.querySelector<HTMLElement>('[data-admin]')!;
const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
const posts: { id: string; title: string; url: string }[] = JSON.parse(root.dataset.posts!);
const filter = get<HTMLSelectElement>('[data-post-filter]'), list = get('[data-comments-list]'), more = get<HTMLButtonElement>('[data-more]'), clear = get<HTMLButtonElement>('[data-clear-post]');
const login = get<HTMLAnchorElement>('[data-login-link]'); login.href = root.dataset.accountUrl! + '?return=' + encodeURIComponent(location.pathname);
let view = 'active', page: Page | null = null, loading = false, mutating = false, admin: User | null = null, setupToken = '';
function message(text: string, error = false) { const node = get('[data-message]'); node.textContent = text; node.toggleAttribute('data-error', error); }
function restrict(error: unknown) {
  if ([401, 403].includes((error as { status?: number })?.status || 0)) { get('[data-dashboard]').hidden = true; get('[data-access]').hidden = false; list.replaceChildren(); page = null; }
}
function node(tag: string, className: string, value = '') { const item = document.createElement(tag); item.className = className; item.textContent = value; return item; }
const format = (time: number) => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(time);
function controls() {
  const busy = loading || mutating;
  filter.disabled = busy; more.disabled = busy; clear.disabled = busy || !page?.counts.active;
  root.querySelectorAll<HTMLButtonElement>('[data-refresh], [data-view], .admin-comment-actions button').forEach(button => button.disabled = busy);
  clear.hidden = !filter.value || view !== 'active';
}
function confirmDelete(text: string) {
  const dialog = get<HTMLDialogElement>('[data-confirm]'); get('[data-confirm-text]').textContent = text;
  dialog.returnValue = ''; dialog.showModal();
  return new Promise<boolean>(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
}
async function mutate(path: string, data: object, prompt?: string) {
  if (loading || mutating || (prompt && !await confirmDelete(prompt))) return;
  mutating = true; controls();
  try { const result = await accountRequest(path, data); await load(); message(`${path.endsWith('/restore') ? '已恢复' : '已移入回收站'} ${result.affected} 条评论。`); }
  catch (error) { restrict(error); message(error instanceof Error ? error.message : '操作失败，请重试。', true); }
  finally { mutating = false; controls(); }
}
function display(item: Entry) {
  const card = node('article', 'admin-comment' + (item.role === 'ai' ? ' is-ai' : '')), meta = node('div', 'admin-meta');
  const article = posts.find(post => post.id === item.post), title = document.createElement('a'); title.textContent = article?.title || item.post; title.href = article?.url || import.meta.env.BASE_URL;
  meta.append(node('strong', '', item.nickname), node('span', '', item.role === 'ai' ? 'AI 回复' : item.parent_id ? '读者回复' : '讨论'), title, node('time', '', format(item.created_at))); card.append(meta);
  if (item.quote) card.append(node('blockquote', '', item.quote)); card.append(renderComment(item.body));
  const actions = node('div', 'admin-comment-actions'), button = document.createElement('button'); button.type = 'button';
  if (view === 'trash') {
    actions.append(node('span', '', '删除于 ' + format(item.deleted_at!)));
    button.textContent = `恢复此次删除（${item.deletion_size} 条）`;
    button.addEventListener('click', () => mutate(`/admin/actions/${item.deleted_group}/restore`, {}));
  } else {
    const link = document.createElement('a'); link.textContent = '查看讨论 ↗'; link.href = title.href + '#comment-' + encodeURIComponent(item.id); actions.append(link);
    button.textContent = item.parent_id ? '删除此条及其回复' : '删除整条讨论';
    button.addEventListener('click', () => mutate(`/admin/comments/${item.id}/delete`, { scope: item.parent_id ? 'entry' : 'thread' }, item.parent_id ? '将此条评论及其后续回复移入回收站，并取消相关待答任务。可在回收站恢复。' : '将整条讨论及所有回复移入回收站，并取消相关待答任务。可在回收站恢复。'));
  }
  actions.append(button); card.append(actions); return card;
}
async function load(append = false) {
  if (loading) return; loading = true; if (!append) { page = null; list.replaceChildren(); } controls(); message('正在加载评论…');
  try {
    const query = new URLSearchParams({ view, post: filter.value });
    if (append && page?.next) { query.set('before', String(page.next.before)); query.set('beforeId', page.next.beforeId); }
    const data = await accountRequest('/admin/comments?' + query) as Page; page = data;
    for (const item of data.posts) if (![...filter.options].some(option => option.value === item.post)) { const option = document.createElement('option'); option.value = item.post; option.textContent = posts.find(post => post.id === item.post)?.title || item.post; filter.append(option); }
    data.comments.forEach(item => list.append(display(item)));
    if (!list.childElementCount) list.append(node('p', 'admin-empty', view === 'trash' ? '回收站为空。' : '还没有公开评论。'));
    get('[data-active-count]').textContent = String(data.counts.active); get('[data-trash-count]').textContent = String(data.counts.trash); more.hidden = !data.next; message('');
  } catch (error) { restrict(error); message(error instanceof Error ? error.message : '加载失败。', true); }
  finally { loading = false; controls(); }
}
async function dashboard(user: User) { admin = user; get('[data-username]').textContent = user.username; get('[data-dashboard]').hidden = false; get('[data-access]').hidden = true; await load(); }
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => { view = button.dataset.view!; root.querySelectorAll<HTMLElement>('[data-view]').forEach(tab => tab.setAttribute('aria-pressed', String(tab.dataset.view === view))); load(); }));
filter.addEventListener('change', () => load()); get('[data-refresh]').addEventListener('click', () => load()); more.addEventListener('click', () => load(true));
clear.addEventListener('click', () => { if (!filter.value || !page) return; const title = posts.find(post => post.id === filter.value)?.title || filter.value; mutate('/admin/comments/clear', { post: filter.value }, `将《${title}》的 ${page.counts.active} 条公开评论及回复移入回收站，并取消相关待答任务。可在回收站恢复。`); });
get('[data-logout]').addEventListener('click', async () => { try { await accountRequest('/auth/logout', {}); saveToken(''); location.assign(root.dataset.accountUrl!); } catch (error) { message(error instanceof Error ? error.message : '退出失败。', true); } });
const setupForm = get<HTMLFormElement>('[data-setup-form]'), validatePassword = bindPasswordConfirmation(setupForm);
setupForm.addEventListener('submit', async event => {
  event.preventDefault(); validatePassword(); if (mutating || !setupForm.reportValidity()) return; mutating = true; const button = setupForm.querySelector<HTMLButtonElement>('button')!; button.disabled = true;
  try {
    const result = await accountRequest('/auth/admin-setup', { setupToken, password: (setupForm.elements.namedItem('password') as HTMLInputElement).value });
    saveToken(result.token); admin = result.user; setupToken = ''; try { sessionStorage.removeItem('yifan-admin-setup'); } catch {} setupForm.reset();
    get('[data-setup]').hidden = true; get('[data-recovery-code]').textContent = result.recoveryCode; get('[data-recovery]').hidden = false; message('管理员账号已激活，请保存找回码。');
  } catch (error) { message(error instanceof Error ? error.message : '激活失败。', true); }
  finally { mutating = false; button.disabled = false; }
});
get('[data-copy-recovery]').addEventListener('click', async () => { try { await navigator.clipboard.writeText(get('[data-recovery-code]').textContent || ''); message('找回码已复制。'); } catch { message('请手动复制找回码。'); } });
get('[data-recovery-done]').addEventListener('click', () => { get('[data-recovery-code]').textContent = ''; get('[data-recovery]').hidden = true; if (admin) dashboard(admin); });
window.addEventListener('storage', event => { if (event.key === 'yifan-account-session') location.reload(); });
async function initialize() {
  try {
    const fragment = new URLSearchParams(location.hash.slice(1)), incoming = fragment.get('setup');
    if (incoming) { setupToken = incoming; history.replaceState(null, '', location.pathname + location.search); try { sessionStorage.setItem('yifan-admin-setup', incoming); } catch {} }
    else try { setupToken = sessionStorage.getItem('yifan-admin-setup') || ''; } catch {}
    if (setupToken) {
      const data = await accountRequest('/auth/admin-setup-info', { setupToken }); (setupForm.elements.namedItem('username') as HTMLInputElement).value = data.username;
      get('[data-setup]').hidden = false; setupForm.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false; message('请设置你自己的管理员密码。'); return;
    }
    const user = await currentUser();
    if (user?.role === 'admin') await dashboard(user);
    else { get('[data-access]').hidden = false; message(user ? '当前账号没有管理员权限。' : '请先登录管理员账号。'); }
  } catch (error) { if ((error as { status?: number })?.status === 401 && setupToken) { setupToken = ''; try { sessionStorage.removeItem('yifan-admin-setup'); } catch {} } get('[data-access]').hidden = false; message(error instanceof Error ? error.message : '暂时无法访问后台。', true); }
}
initialize();
