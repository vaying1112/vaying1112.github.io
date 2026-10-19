import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { siteConfig, href } from '../site';

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
  return rss({ title: siteConfig.title, description: siteConfig.description,
    site: context.site || 'http://localhost:4321',
    items: posts.map(post => ({ title: post.data.title, pubDate: post.data.date, description: post.data.description, link: href(`posts/${post.id}/`) })),
    customData: '<language>zh-CN</language>',
  });
}
