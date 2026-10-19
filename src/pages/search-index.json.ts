import { getCollection, getEntry } from 'astro:content';
import type { APIRoute } from 'astro';
import { href, showDrafts } from '../site';

export const GET: APIRoute = async () => {
  const posts = await getCollection('posts', ({ data }) => showDrafts || !data.draft);
  const entries = posts.map(post => ({
    title: post.data.title, description: post.data.description,
    tags: post.data.tags, url: href(`posts/${post.id}/`),
    draft: post.data.draft, content: post.body || '',
  }));
  const math = await getEntry('foundations', 'math-basics');
  if (math) entries.push({ title: math.data.title, description: math.data.description, tags: ['数学基础'], url: href('math/'), draft: false, content: math.body || '' });
  return Response.json(entries);
};
