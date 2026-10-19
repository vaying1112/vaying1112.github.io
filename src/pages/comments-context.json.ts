import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { href } from '../site';

// Only public articles enter the answer context, even in local development.
export const GET: APIRoute = async () => {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  return Response.json({ posts: posts.map(post => ({
    id: post.id,
    title: post.data.title,
    url: href(`posts/${post.id}/`),
    body: (post.body || '').replace(/^import .+;?\s*$/gm, ''),
  })) });
};
