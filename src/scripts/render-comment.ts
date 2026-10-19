import { Marked, type Token, type Tokens } from 'marked';
import katex from 'katex';

// Math is tokenized before Markdown so that backslashes and subscripts survive.
const markdown = new Marked({ gfm: true, extensions: [{
  name: 'commentMath', level: 'inline',
  start(source: string) { const index = source.search(/\$|\\[([]/); return index < 0 ? undefined : index; },
  tokenizer(source: string) {
    const match = /^(?:\$\$([\s\S]+?)\$\$|\$([^\n$]+?)\$(?!\$)|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\))/.exec(source);
    if (match) return { type: 'commentMath', raw: match[0], text: match[1] || match[2] || match[3] || match[4], display: Boolean(match[1] || match[3]) };
    return undefined;
  },
}] });

export function renderComment(value: string) {
  const root = document.createElement('div'); root.className = 'comment-body';
  appendTokens(root, markdown.lexer(value));
  return root;
}

function appendTokens(parent: HTMLElement, tokens: Token[], depth = 0) {
  if (depth > 16) return;
  for (const token of tokens) {
    if (token.type === 'space' || token.type === 'def') continue;
    const element = (tag: string, children: Token[] = []) => {
      const node = document.createElement(tag); appendTokens(node, children, depth + 1); parent.append(node); return node;
    };
    switch (token.type) {
      case 'commentMath': {
        const span = document.createElement('span');
        katex.render(token.text, span, { displayMode: token.display, throwOnError: false, trust: false, strict: 'ignore', maxExpand: 200, maxSize: 10 });
        parent.append(span); break;
      }
      case 'paragraph': element('p', token.tokens); break;
      case 'heading': element('h4', token.tokens); break;
      case 'strong': element('strong', token.tokens); break;
      case 'em': element('em', token.tokens); break;
      case 'del': element('del', token.tokens); break;
      case 'blockquote': element('blockquote', token.tokens); break;
      case 'list': {
        const list = document.createElement(token.ordered ? 'ol' : 'ul');
        if (list instanceof HTMLOListElement && typeof token.start === 'number') list.start = token.start;
        for (const item of token.items as Tokens.ListItem[]) { const li = document.createElement('li'); appendTokens(li, item.tokens, depth + 1); list.append(li); }
        parent.append(list); break;
      }
      case 'code': { const pre = document.createElement('pre'); const code = document.createElement('code'); code.textContent = token.text; pre.append(code); parent.append(pre); break; }
      case 'codespan': { const code = document.createElement('code'); code.textContent = token.text; parent.append(code); break; }
      case 'br': parent.append(document.createElement('br')); break;
      case 'hr': parent.append(document.createElement('hr')); break;
      case 'link': {
        const link = document.createElement('a'); appendTokens(link, token.tokens || [], depth + 1);
        try { const url = new URL(token.href, location.href); if (['https:', 'http:'].includes(url.protocol)) { link.href = url.href; link.target = '_blank'; link.rel = 'nofollow noopener noreferrer'; } } catch {}
        parent.append(link); break;
      }
      case 'table': {
        const wrap = document.createElement('div'); wrap.className = 'comment-table';
        const table = document.createElement('table'); const thead = document.createElement('thead'); const head = document.createElement('tr');
        for (const cell of token.header as Tokens.TableCell[]) { const th = document.createElement('th'); appendTokens(th, cell.tokens, depth + 1); head.append(th); }
        thead.append(head); table.append(thead); const tbody = document.createElement('tbody');
        for (const row of token.rows as Tokens.TableCell[][]) { const tr = document.createElement('tr'); for (const cell of row) { const td = document.createElement('td'); appendTokens(td, cell.tokens, depth + 1); tr.append(td); } tbody.append(tr); }
        table.append(tbody); wrap.append(table); parent.append(wrap); break;
      }
      case 'text': if (token.tokens) appendTokens(parent, token.tokens, depth + 1); else parent.append(document.createTextNode(token.text)); break;
      case 'escape': parent.append(document.createTextNode(token.text)); break;
      // Raw HTML and images are shown as text; no visitor-provided HTML is executed.
      default: parent.append(document.createTextNode(token.raw || ''));
    }
  }
}
