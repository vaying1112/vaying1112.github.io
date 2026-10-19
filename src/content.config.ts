import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

const foundations = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/foundations' }),
  schema: z.object({ title: z.string(), description: z.string() }),
});

export const collections = { posts, foundations };
