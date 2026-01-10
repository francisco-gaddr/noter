const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const escapeAttr = (input: string) => escapeHtml(input);

const stripHtml = (html: string) => {
  // Decode common entities first to avoid "div" showing up if it was &lt;div&gt;
  const decoded = html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
  return decoded.replace(/<[^>]*>?/gm, '');
};

const isSlateText = (
  node: any
): node is {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  code?: boolean;
} => !!node && typeof node === 'object' && typeof node.text === 'string';

const isSlateElement = (node: any): node is { type: string; children: any[] } =>
  !!node && typeof node === 'object' && typeof node.type === 'string' && Array.isArray((node as any).children);

const slateLeafToHtml = (leaf: any) => {
  if (!isSlateText(leaf)) return '';
  let html = escapeHtml(leaf.text || '');
  if (leaf.code) html = `<code>${html}</code>`;
  if (leaf.bold) html = `<strong>${html}</strong>`;
  if (leaf.italic) html = `<em>${html}</em>`;
  if (leaf.underline) html = `<u>${html}</u>`;
  return html;
};

const slateNodeToHtml = (node: any): string => {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(slateNodeToHtml).join('');
  if (isSlateText(node)) return slateLeafToHtml(node);
  if (!isSlateElement(node)) return '';

  const childrenHtml = node.children.map(slateNodeToHtml).join('') || '';

  switch (node.type) {
    case 'paragraph':
      return `<p>${childrenHtml || '<br>'}</p>`;
    case 'heading-one':
      return `<h1>${childrenHtml}</h1>`;
    case 'heading-two':
      return `<h2>${childrenHtml}</h2>`;
    case 'block-quote':
      return `<blockquote>${childrenHtml}</blockquote>`;
    case 'bulleted-list':
      return `<ul>${childrenHtml}</ul>`;
    case 'numbered-list':
      return `<ol>${childrenHtml}</ol>`;
    case 'list-item':
      return `<li>${childrenHtml}</li>`;
    case 'check-list-item': {
      const checked = Boolean((node as any).checked);
      return `<li data-list="${checked ? 'checked' : 'unchecked'}">${childrenHtml}</li>`;
    }
    case 'link': {
      const url = typeof (node as any).url === 'string' ? (node as any).url : '';
      if (!url) return childrenHtml;
      return `<a href="${escapeAttr(url)}">${childrenHtml}</a>`;
    }
    case 'image': {
      const url = typeof (node as any).url === 'string' ? (node as any).url : '';
      if (!url) return '';
      return `<img src="${escapeAttr(url)}" alt="" />`;
    }
    case 'video': {
      const url = typeof (node as any).url === 'string' ? (node as any).url : '';
      if (!url) return '';
      return `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`;
    }
    case 'table':
      return `<table style="border-collapse: collapse; width: 100%; border: 1px solid #ddd;"><tbody>${childrenHtml}</tbody></table>`;
    case 'table-row':
      return `<tr>${childrenHtml}</tr>`;
    case 'table-cell':
      return `<td style="border: 1px solid #ddd; padding: 8px;">${childrenHtml}</td>`;
    default:
      return `<p>${childrenHtml || '<br>'}</p>`;
  }
};

const slateValueToHtml = (value: any): string => {
  if (!value) return '';
  if (!Array.isArray(value)) return slateNodeToHtml(value);
  let html = '';
  let checkItems: any[] = [];

  const flushCheckItems = () => {
    if (!checkItems.length) return;
    const itemsHtml = checkItems.map(slateNodeToHtml).join('');
    html += `<ul>${itemsHtml}</ul>`;
    checkItems = [];
  };

  for (const node of value) {
    if (isSlateElement(node) && node.type === 'check-list-item') {
      checkItems.push(node);
      continue;
    }
    flushCheckItems();
    html += slateNodeToHtml(node);
  }
  flushCheckItems();
  return html;
};

const slateNodeToText = (node: any): string => {
  if (!node) return '';
  if (Array.isArray(node)) return node.map(slateNodeToText).join('\n');
  if (typeof node === 'string') return node;
  if (isSlateText(node)) return node.text || '';
  if (isSlateElement(node)) return node.children.map(slateNodeToText).join('');
  if (node && typeof node === 'object' && Array.isArray((node as any).content)) {
    return (node as any).content.map(slateNodeToText).join('');
  }
  return '';
};

const slateValueToText = (value: any): string => {
  if (!value) return '';
  const raw = Array.isArray(value)
    ? value.map(slateNodeToText).join('\n')
    : slateNodeToText(value);
  return raw
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const tiptapJsonToText = (json: any): string => {
  if (!json) return '';
  if (typeof json === 'string') return json;
  if (Array.isArray(json)) return json.map(tiptapJsonToText).join('\n');
  if (typeof json !== 'object') return '';
  if (typeof json.text === 'string') return json.text;
  if (Array.isArray(json.content)) return json.content.map(tiptapJsonToText).join('');
  return '';
};

const parseJsonChain = (input: string, maxDepth = 3): any => {
  let current: any = input;
  for (let i = 0; i < maxDepth; i++) {
    if (typeof current !== 'string') return current;
    const trimmed = current.trim();
    if (!trimmed) return trimmed;
    if (!['{', '[', '"'].includes(trimmed[0] as any)) return current;
    try {
      current = JSON.parse(current);
    } catch {
      return current;
    }
  }
  return current;
};

const extractUnknownText = (node: any, visited?: WeakSet<object>): string => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) {
    const parts = node
      .map((n) => extractUnknownText(n, visited))
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.join(' ');
  }
  if (typeof node !== 'object') return '';
  const set = visited ?? new WeakSet<object>();
  if (set.has(node)) return '';
  set.add(node);

  const asAny = node as any;
  if (typeof asAny.text === 'string') return asAny.text;
  if (Array.isArray(asAny.content)) return extractUnknownText(asAny.content, set);
  if (Array.isArray(asAny.children)) return extractUnknownText(asAny.children, set);

  const parts: string[] = [];
  for (const key of Object.keys(asAny)) {
    const val = asAny[key];
    const text = extractUnknownText(val, set).trim();
    if (text) parts.push(text);
  }
  return parts.join(' ');
};

export const noteContentToPlainText = (content: any): string => {
  if (!content) return '';

  if (typeof content === 'string') {
    const parsed = parseJsonChain(content);
    if (Array.isArray(parsed)) return slateValueToText(parsed);
    if (parsed && typeof parsed === 'object') {
      if (isSlateElement(parsed) || isSlateText(parsed) || Array.isArray((parsed as any).children)) {
        return slateValueToText(parsed);
      }
      if ((parsed as any).type === 'doc' || Array.isArray((parsed as any).content)) {
        return tiptapJsonToText(parsed).trim();
      }
      const extracted = extractUnknownText(parsed).trim();
      if (extracted) return extracted;
      return '';
    }

    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) return stripHtml(trimmed).trim();
      return trimmed;
    }
    return String(parsed).trim();
  }

  if (Array.isArray(content)) return slateValueToText(content);

  if (content && typeof content === 'object') {
    if (isSlateElement(content) || isSlateText(content) || Array.isArray((content as any).children)) {
      return slateValueToText(content);
    }
    if ((content as any).type === 'doc' || Array.isArray((content as any).content)) {
      return tiptapJsonToText(content).trim();
    }
    const extracted = extractUnknownText(content).trim();
    if (extracted) return extracted;
    return '';
  }

  return String(content).trim();
};

export const tiptapJsonToHtml = (json: any): string => {
  if (!json) return '';
  
  if (typeof json === 'string') {
    const parsed = parseJsonChain(json);
    if (Array.isArray(parsed)) return slateValueToHtml(parsed);
    if (parsed && typeof parsed === 'object') {
      if (isSlateElement(parsed) || isSlateText(parsed) || Array.isArray((parsed as any).children)) {
        return slateValueToHtml(parsed);
      }
      if ((parsed as any).type || (parsed as any).content) {
        return tiptapJsonToHtml(parsed);
      }
      const extracted = extractUnknownText(parsed).trim();
      if (extracted) return `<p>${escapeHtml(extracted)}</p>`;
      return '';
    }

    if (typeof parsed === 'string') {
      const trimmed = parsed.trim();
      if (/<\/?[a-z][\s\S]*>/i.test(trimmed)) return parsed;
      if (!trimmed) return '';
      return `<p>${escapeHtml(parsed)}</p>`;
    }
    return `<p>${escapeHtml(String(parsed))}</p>`;
  }

  // Handle Tiptap JSON structure
  if (json.type === 'doc' && json.content) {
    return json.content.map((node: any) => tiptapJsonToHtml(node)).join('');
  }

  let content = '';
  if (json.content) {
    content = json.content.map((node: any) => tiptapJsonToHtml(node)).join('');
  }

  switch (json.type) {
    case 'paragraph':
      return `<p>${content || '<br>'}</p>`;
    case 'heading':
      return `<h${json.attrs?.level || 1}>${content}</h${json.attrs?.level || 1}>`;
    case 'text':
      let text = json.text || '';
      if (json.marks) {
        json.marks.forEach((mark: any) => {
          if (mark.type === 'bold') text = `<strong>${text}</strong>`;
          if (mark.type === 'italic') text = `<em>${text}</em>`;
          if (mark.type === 'strike') text = `<s>${text}</s>`;
          if (mark.type === 'underline') text = `<u>${text}</u>`;
          if (mark.type === 'link') text = `<a href="${mark.attrs.href}">${text}</a>`;
        });
      }
      return text;
    case 'bulletList':
      return `<ul>${content}</ul>`;
    case 'orderedList':
      return `<ol>${content}</ol>`;
    case 'listItem':
      return `<li>${content}</li>`;
    case 'blockquote':
      return `<blockquote>${content}</blockquote>`;
    case 'codeBlock':
      return `<pre><code>${content}</code></pre>`;
    case 'image':
      return `<img src="${json.attrs.src}" alt="${json.attrs.alt || ''}" />`;
    case 'hardBreak':
        return '<br>';
    default:
      return content;
  }
};

export const htmlToTiptapJson = (html: string): any => {
    // This is hard to do reliably without Tiptap dependencies.
    // For now, we might rely on the fact that mobile editor produces HTML
    // and we might need to store it as HTML or convert it if possible.
    // However, the backend/web expects Tiptap JSON?
    // If Web uses Tiptap, it saves JSON.
    // If Mobile saves HTML, Web Tiptap might break if it tries to load HTML as JSON.
    // Ideally, we should unify storage format.
    // If we can't easily convert HTML -> JSON on mobile, we can wrap it in a Tiptap-compatible structure
    // e.g. a single HTML block or parse it roughly.
    // Or, we store as string and let Web Tiptap handle it (Tiptap can import HTML).
    
    // Simplest Tiptap JSON wrapper for raw text/html if we can't parse:
    // But wait, if we send HTML string to backend, and backend validates/types?
    // Shared interface says `content: string`.
    // Web Tiptap saves JSON string.
    // Mobile Editor saves HTML string.
    // If Web Tiptap receives HTML string, does it work?
    // `editor.commands.setContent(content)` in Tiptap handles HTML string or JSON object.
    // So if Mobile sends HTML string, Web should be fine!
    // The only issue is if Mobile receives JSON string, it needs to render it.
    
    return html; 
};
