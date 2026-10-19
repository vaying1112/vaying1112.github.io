import { createHash } from 'node:crypto';

const articles = new Map();

// Reuse a stable, complete public article. Never cache a visitor's question here.
export function articleFor(article) {
  const data = { title: String(article.title || ''), body: String(article.body || '') };
  const version = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  if (!articles.has(version)) {
    if (articles.size >= 16) articles.delete(articles.keys().next().value);
    articles.set(version, Object.freeze({ version, ...data }));
  }
  return articles.get(version);
}

export function contextFor(job) {
  const history = (job.history || []).slice(-12).map(item => ({ role: item.role, body: item.body, quote: item.quote }));
  const last = history.at(-1);
  // The queue's history includes the current question. Send it only once.
  if (last?.role === 'reader' && last.body === job.comment.body && (last.quote || '') === (job.comment.quote || '')) history.pop();
  return { article: articleFor(job.article), history, comment: { body: job.comment.body, quote: job.comment.quote } };
}
