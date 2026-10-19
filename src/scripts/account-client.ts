export interface User { id: string; username: string; created_at: number; role: 'reader' | 'admin'; }
const key = 'yifan-account-session';
export const api = import.meta.env.PUBLIC_COMMENTS_API?.replace(/\/$/, '') || '';
export function token() { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
export function saveToken(value: string) {
  try { if (value) localStorage.setItem(key, value); else localStorage.removeItem(key); }
  catch { throw new Error('浏览器禁用了本地存储，请允许后再登录。'); }
}
export async function accountRequest(path: string, body?: unknown) {
  const response = await fetch(api + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token() ? { Authorization: `Bearer ${token()}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000), cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth/')) saveToken('');
    throw Object.assign(new Error(data.error || '服务暂时不可用，请稍后再试。'), { status: response.status });
  }
  return data;
}
export async function currentUser(): Promise<User | null> { if (!token()) return null; return (await accountRequest('/me')).user; }
