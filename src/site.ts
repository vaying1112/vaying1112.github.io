export const siteConfig = {
  title: '一帆书签',
  description: '数学、模型原理与代码笔记。',
};

export function href(path = '') {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai',
  }).format(date).replaceAll('/', '.');
}

export const showDrafts = import.meta.env.DEV || import.meta.env.INCLUDE_DRAFTS === 'true';
