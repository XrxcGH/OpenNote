// Turns a piece of a web page into Markdown for a new OpenNote page. It keeps headings, paragraphs, lists, quotes,
// code, tables, links, and pictures, and drops scripts, styles, forms, and anything hidden. Links and pictures keep
// only http, https, and mailto addresses, made absolute against the page, so nothing like javascript: reaches a note.

const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'CANVAS',
  'SVG',
  'FORM',
  'INPUT',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
  'DIALOG',
  'HEAD',
  'META',
  'LINK',
]);
const BLOCKS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'NAV',
  'FIGURE',
  'FIGCAPTION',
  'ADDRESS',
  'DETAILS',
  'SUMMARY',
  'BODY',
  'CENTER',
  'DL',
  'DT',
  'DD',
]);

/** An address that may go in a note, made absolute, or null. */
export function safeUrl(href, base) {
  if (!href) return null;
  try {
    const url = new URL(href, base);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function escapeText(text) {
  return text.replace(/([\\`*_[\]<>#|])/g, '\\$1');
}

function isHidden(element) {
  if (element.hidden || element.getAttribute('aria-hidden') === 'true') return true;
  const style = element.getAttribute('style') ?? '';
  return /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style);
}

function inline(node, base) {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out += escapeText(child.nodeValue.replace(/\s+/g, ' '));
      continue;
    }
    if (child.nodeType !== 1 || SKIP.has(child.tagName) || isHidden(child)) continue;
    const tag = child.tagName;
    if (tag === 'BR') out += '  \n';
    else if (tag === 'STRONG' || tag === 'B') out += wrap(inline(child, base), '**');
    else if (tag === 'EM' || tag === 'I') out += wrap(inline(child, base), '_');
    else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') out += wrap(inline(child, base), '~~');
    else if (tag === 'CODE') out += codeSpan(child.textContent ?? '');
    else if (tag === 'A') {
      const text = inline(child, base).trim();
      const href = safeUrl(child.getAttribute('href'), base);
      out += href && text ? `[${text}](${href.replace(/\)/g, '%29')})` : text;
    } else if (tag === 'IMG') out += image(child, base);
    else out += inline(child, base);
  }
  return out;
}

function wrap(text, mark) {
  const trimmed = text.trim();
  return trimmed ? `${mark}${trimmed}${mark}` : text;
}

function codeSpan(text) {
  const fence = text.includes('`') ? '``' : '`';
  return `${fence}${text.replace(/\s+/g, ' ')}${fence}`;
}

function image(element, base) {
  const src = safeUrl(element.getAttribute('src') ?? element.getAttribute('data-src'), base);
  if (!src || src.startsWith('mailto:')) return '';
  const alt = (element.getAttribute('alt') ?? '').replace(/[[\]\n]/g, ' ').trim();
  return `![${alt}](${src.replace(/\)/g, '%29')})`;
}

function list(element, base, depth) {
  const ordered = element.tagName === 'OL';
  const lines = [];
  let number = Number(element.getAttribute('start')) || 1;
  for (const item of element.children) {
    if (item.tagName !== 'LI') continue;
    const marker = ordered ? `${number++}.` : '-';
    const pad = '  '.repeat(depth);
    const nested = [];
    const own = itemText(item, base, depth, nested);
    lines.push(`${pad}${marker} ${own}`.trimEnd());
    lines.push(...nested);
  }
  return lines.join('\n');
}

// The text of a list item, with its nested lists collected separately so they indent under it.
function itemText(item, base, depth, nested) {
  let text = '';
  for (const child of item.childNodes) {
    if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) {
      nested.push(list(child, base, depth + 1));
    } else if (child.nodeType === 1 && BLOCKS.has(child.tagName)) {
      text += ` ${inline(child, base)}`;
    } else if (child.nodeType === 1 || child.nodeType === 3) {
      const holder = child.ownerDocument.createElement('span');
      holder.appendChild(child.cloneNode(true));
      text += inline(holder, base);
    }
  }
  return text.replace(/\s+/g, ' ').trim();
}

function table(element, base) {
  const rows = [...element.querySelectorAll('tr')].map((row) =>
    [...row.children].map((cell) => inline(cell, base).replace(/\s+/g, ' ').trim()),
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells) => `| ${Array.from({ length: width }, (_, at) => cells[at] ?? '').join(' | ')} |`;
  return [line(rows[0]), line(Array(width).fill('---')), ...rows.slice(1).map(line)].join('\n');
}

function blocks(node, base, out) {
  let text = '';
  const flush = () => {
    const trimmed = text.replace(/[ \t]+\n/g, '\n').trim();
    if (trimmed) out.push(trimmed);
    text = '';
  };
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      text += escapeText(child.nodeValue.replace(/\s+/g, ' '));
      continue;
    }
    if (child.nodeType !== 1 || SKIP.has(child.tagName) || isHidden(child)) continue;
    const tag = child.tagName;
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) {
      flush();
      const words = inline(child, base).trim();
      if (words) out.push(`${'#'.repeat(Number(heading[1]))} ${words}`);
    } else if (tag === 'UL' || tag === 'OL') {
      flush();
      const items = list(child, base, 0);
      if (items) out.push(items);
    } else if (tag === 'PRE') {
      flush();
      const code = (child.textContent ?? '').replace(/\n$/, '');
      const fence = code.includes('```') ? '~~~' : '```';
      out.push(`${fence}\n${code}\n${fence}`);
    } else if (tag === 'BLOCKQUOTE') {
      flush();
      const inner = [];
      blocks(child, base, inner);
      if (inner.length) out.push(inner.join('\n\n').replace(/^/gm, '> '));
    } else if (tag === 'TABLE') {
      flush();
      const rows = table(child, base);
      if (rows) out.push(rows);
    } else if (tag === 'HR') {
      flush();
      out.push('---');
    } else if (BLOCKS.has(tag)) {
      flush();
      blocks(child, base, out);
    } else {
      const holder = child.ownerDocument.createElement('span');
      holder.appendChild(child.cloneNode(true));
      text += inline(holder, base);
    }
  }
  flush();
}

/** Markdown for an element and everything in it. `base` is the page's address, for relative links. */
export function toMarkdown(root, base) {
  const out = [];
  blocks(root, base, out);
  return out
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
