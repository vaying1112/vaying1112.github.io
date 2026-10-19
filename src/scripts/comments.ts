import { accountRequest, currentUser, token, type User } from './account-client';
import { renderComment } from './render-comment';

interface Entry { id: string; parent_id: string | null; reply_to: string | null; nickname: string; body: string; quote: string; anchor: string; role: string; ai_status: string; created_at: number; }
interface Thread extends Entry { replies: Entry[]; }
interface Page { threads: Thread[]; total: number; next: { before: number; beforeId: string } | null; }

const root = document.querySelector<HTMLElement>('[data-comments]');
if (root) initialize(root);

function initialize(root: HTMLElement) {
  const api = root.dataset.api!;
  const post = root.dataset.post!;
  const article = document.querySelector<HTMLElement>('#article-body')!;
  const form = root.querySelector<HTMLFormElement>('form')!;
  let user: User | null = null;
  const login = root.querySelector<HTMLAnchorElement>('[data-comment-login]')!;
  const draftKey = 'yifan-comment-draft:' + post;
  login.href = root.dataset.accountUrl! + '?return=' + encodeURIComponent(location.pathname + location.search + '#comments');
  function saveDraft() { try { sessionStorage.setItem(draftKey, JSON.stringify({ body: body.value, quote, anchor, replyTo, askAI: askAI.checked })); } catch {} }
  login.addEventListener('click', saveDraft);
  const body = form.elements.namedItem('body') as HTMLTextAreaElement;
  const askAI = form.elements.namedItem('askAI') as HTMLInputElement;
  const message = root.querySelector<HTMLElement>('[data-comment-message]')!;
  const threads = root.querySelector<HTMLElement>('[data-comment-threads]')!;
  const more = root.querySelector<HTMLButtonElement>('[data-load-more]')!;
  const refresh = root.querySelector<HTMLButtonElement>('[data-refresh]')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  const context = root.querySelector<HTMLElement>('[data-compose-context]')!;
  const quoteButton = root.querySelector<HTMLButtonElement>('[data-quote-comment]')!;
  let quote = '', anchor = '', replyTo: string | null = null;
  let selection: { text: string; anchor: string } | null = null;
  let requestId = crypto.randomUUID();
  let page: Page | null = null;
  let loading = false, sending = false, visible = false;
  let entries: Thread[] = [];
  function syncUser() { currentUser().then(value => { user = value; root.querySelector<HTMLElement>('[data-comment-user]')!.textContent = value ? '以 ' + value.username + ' 的身份评论' : '登录后发表评论'; login.textContent = value ? '我的评论 ↗' : '登录 / 注册 ↗'; login.href = root.dataset.accountUrl! + (value ? '' : '?return=' + encodeURIComponent(location.pathname + location.search + '#comments')); }).catch(error => { user = null; status(error.message, true); }); }
  syncUser();
  window.addEventListener('storage', event => { if (event.key === 'yifan-account-session') syncUser(); });
  window.addEventListener('pageshow', event => { if (event.persisted) syncUser(); });
  try { const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null'); if (draft) { body.value = draft.body || ''; quote = draft.quote || ''; anchor = draft.anchor || ''; replyTo = draft.replyTo || null; askAI.checked = draft.askAI !== false; if (quote || replyTo) compose(quote ? '评论选中的原文' : '继续回复'); root.querySelector<HTMLElement>('[data-character-count]')!.textContent = `${body.value.length} / 2000`; } } catch {}

  function status(value: string, error = false) { message.textContent = value; message.toggleAttribute('data-error', error); }
  function clearContext() { quote = ''; anchor = ''; replyTo = null; context.hidden = true; requestId = crypto.randomUUID(); }
  function compose(label: string) {
    context.hidden = false;
    root.querySelector<HTMLElement>('[data-compose-label]')!.textContent = label;
    const block = root.querySelector<HTMLElement>('[data-compose-quote]')!;
    block.hidden = !quote; block.textContent = quote;
    quoteButton.hidden = true;
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    body.focus({ preventScroll: true });
    requestId = crypto.randomUUID();
  }
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', value = '') {
    const element = document.createElement(tag);
    element.className = className; element.textContent = value;
    return element;
  }
  function locate(item: Entry) {
    const target = item.anchor ? document.getElementById(item.anchor) : article;
    if (!target || !article.contains(target)) { status('原文可能已更新，可根据引用内容在文章中查找。'); return; }
    let element = target;
    if (item.quote) {
      const all = [...article.querySelectorAll<HTMLElement>('p, li, pre')];
      const headings = [...article.querySelectorAll<HTMLElement>('h2[id], h3[id]')];
      const position = headings.indexOf(target);
      const next = position >= 0 ? headings.slice(position + 1).find(h => Number(h.tagName.slice(1)) <= Number(target.tagName.slice(1))) : undefined;
      const scoped = position >= 0 ? all.filter(p => Boolean(target.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING) && (!next || Boolean(p.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING))) : all.filter(p => target === article || target.contains(p));
      const match = scoped.find(p => p.textContent?.replace(/\s+/g, ' ').includes(item.quote));
      if (match) element = match;
    }
    for (const details of [element, ...ancestors(element)].filter((x): x is HTMLDetailsElement => x instanceof HTMLDetailsElement)) details.open = true;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    element.classList.add('comment-highlight');
    setTimeout(() => element.classList.remove('comment-highlight'), 2500);
  }
  function ancestors(element: HTMLElement) { const list: HTMLElement[] = []; let p = element.parentElement; while (p && p !== article) { list.push(p); p = p.parentElement; } return list; }
  function displayEntry(item: Entry) {
    const element = node('div', 'comment-entry' + (item.role === 'ai' ? ' is-ai' : ''));
    element.id = `comment-${item.id}`;
    const meta = node('div', 'comment-meta');
    meta.append(node('strong', '', item.nickname));
    if (item.role === 'ai') meta.append(node('span', 'comment-role', 'AI 回复'));
    const time = node('time', '', new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(item.created_at));
    time.dateTime = new Date(item.created_at).toISOString(); meta.append(time); element.append(meta);
    if (item.quote) { const button = node('button', 'comment-quote', '“' + item.quote + '”'); button.type = 'button'; button.title = '回到引用原文'; button.addEventListener('click', () => locate(item)); element.append(button); }
    element.append(renderComment(item.body));
    const reply = node('button', 'comment-reply', '回复'); reply.type = 'button';
    reply.addEventListener('click', () => { quote = ''; anchor = ''; replyTo = item.id; compose(`回复 ${item.nickname}`); }); element.append(reply);
    const pending = { queued: '等待 AI 回复', working: 'AI 正在解答', failed: 'AI 暂未完成回复' }[item.ai_status];
    if (pending) element.append(node('span', 'comment-ai-status', pending));
    return element;
  }
  function render() {
    threads.replaceChildren();
    for (const thread of entries) {
      const element = node('div', 'comment-thread'); element.append(displayEntry(thread));
      if (thread.replies.length) { const replies = node('div', 'comment-replies'); thread.replies.forEach(reply => replies.append(displayEntry(reply))); element.append(replies); }
      threads.append(element);
    }
    root.querySelector<HTMLElement>('[data-comment-count]')!.textContent = page?.total ? `${page.total} 个讨论` : '';
    more.hidden = !page?.next;
  }
  async function load(append = false, silent = false) {
    if (loading || sending) return;
    loading = true; refresh.disabled = true; more.disabled = true;
    if (!silent) status('正在加载讨论…');
    try {
      const url = new URL(api + '/comments'); url.searchParams.set('post', post);
      if (append && page?.next) { url.searchParams.set('before', String(page.next.before)); url.searchParams.set('beforeId', page.next.beforeId); }
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '评论加载失败。');
      page = data as Page;
      entries = append ? [...entries, ...page.threads] : page.threads;
      const linkedId = location.hash.startsWith('#comment-') ? decodeURIComponent(location.hash.slice(9)) : '';
      if (linkedId && !entries.some(thread => [thread, ...thread.replies].some(item => item.id === linkedId))) {
        const r = await fetch(api + '/comments/thread?' + new URLSearchParams({ post, id: linkedId }));
        if (r.ok) { const linked = (await r.json()).thread as Thread; if (!entries.some(item => item.id === linked.id)) entries.unshift(linked); }
      }
      entries = entries.filter((item, index, all) => all.findIndex(other => other.id === item.id) === index);
      render();
      if (linkedId && !silent) document.getElementById('comment-' + linkedId)?.scrollIntoView({ block: 'center' });
      if (!silent || !message.hasAttribute('data-error')) status(entries.length ? '' : '还没有讨论，写下你的第一个问题。');
    } catch (error) { if (!silent) status(error instanceof Error ? error.message : '评论暂时无法加载，请稍后刷新。', true); }
    finally { loading = false; refresh.disabled = false; more.disabled = false; }
  }
  form.addEventListener('input', () => { requestId = crypto.randomUUID(); root.querySelector<HTMLElement>('[data-character-count]')!.textContent = `${body.value.length} / 2000`; saveDraft(); });
  root.querySelector('[data-clear-context]')!.addEventListener('click', clearContext);
  refresh.addEventListener('click', () => load());
  more.addEventListener('click', () => load(true));
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (sending || !form.reportValidity()) return;
    if (!user) { saveDraft(); location.assign(login.href); return; }
    sending = true; submit.disabled = true; status('正在发表…');
    try {
      await accountRequest('/comments', { id: requestId, post, body: body.value, quote, anchor, replyTo, askAI: askAI.checked, website: (form.elements.namedItem('website') as HTMLInputElement).value });
      try { sessionStorage.removeItem(draftKey); } catch {}
      body.value = ''; clearContext(); root.querySelector<HTMLElement>('[data-character-count]')!.textContent = '0 / 2000';
      sending = false; await load(); status(askAI.checked ? '评论已发表，AI 回复将显示在这条讨论下。' : '评论已发表。');
    } catch (error) { saveDraft(); if (!token()) syncUser(); status(error instanceof Error ? error.message : '发表失败，内容已保留，请重试。', true); }
    finally { sending = false; submit.disabled = false; }
  });
  function updateSelection() {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !s.rangeCount || !article.contains(s.anchorNode) || !article.contains(s.focusNode)) { quoteButton.hidden = true; selection = null; return; }
    const range = s.getRangeAt(0);
    const common = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
    if (common?.closest('button, input, textarea, svg, script, style')) { quoteButton.hidden = true; return; }
    const fragment = range.cloneContents();
    fragment.querySelectorAll('.katex').forEach(math => { const tex = math.querySelector('annotation[encoding="application/x-tex"]')?.textContent; if (tex) math.replaceWith(document.createTextNode(`$${tex}$`)); });
    const value = (fragment.textContent || s.toString()).replace(/\s+/g, ' ').trim();
    if (value.length < 2 || value.length > 600) { quoteButton.hidden = true; return; }
    let location = '';
    const start = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
    const nearest = start?.closest('[id]');
    if (nearest && nearest !== article) location = nearest.id;
    else for (const heading of article.querySelectorAll<HTMLElement>('h2[id], h3[id]')) { if (heading.compareDocumentPosition(range.startContainer) & Node.DOCUMENT_POSITION_FOLLOWING) location = heading.id; }
    selection = { text: value, anchor: location };
    const rect = range.getBoundingClientRect(); quoteButton.hidden = false;
    quoteButton.style.left = `${Math.max(12, Math.min(innerWidth - 125, rect.left + rect.width / 2 - 50))}px`;
    quoteButton.style.top = `${Math.min(innerHeight - 50, Math.max(8, rect.bottom + 8))}px`;
  }
  document.addEventListener('selectionchange', updateSelection);
  quoteButton.addEventListener('pointerdown', event => event.preventDefault());
  quoteButton.addEventListener('click', () => { if (!selection) return; quote = selection.text; anchor = selection.anchor; replyTo = null; compose('评论选中的原文'); window.getSelection()?.removeAllRanges(); });
  window.addEventListener('scroll', () => { quoteButton.hidden = true; }, { passive: true });
  const observer = new IntersectionObserver(items => { visible = items[0].isIntersecting; if (visible && !page && !loading) load(); }, { rootMargin: '150px' }); observer.observe(root);
  const interval = setInterval(() => { if (visible && !document.hidden && entries.length <= 10 && entries.some(thread => [thread, ...thread.replies].some(item => ['queued', 'working'].includes(item.ai_status)))) load(false, true); }, 15000);
  window.addEventListener('pagehide', () => { clearInterval(interval); observer.disconnect(); }, { once: true });
  load();
}
