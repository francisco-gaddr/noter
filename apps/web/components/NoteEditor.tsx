'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createEditor, Descendant, Editor, Transforms, Text, Element as SlateElement, Range, BaseEditor } from 'slate';
import { Slate, Editable, withReact, useSlate, ReactEditor, useSlateStatic, useReadOnly } from 'slate-react';
import { withHistory, HistoryEditor } from 'slate-history';
import { useStore } from '../stores/useStore';
import { debounce } from 'lodash';
import { FaBold, FaItalic, FaUnderline, FaCode, FaListUl, FaListOl, FaQuoteRight, FaLock, FaUnlock, FaLink, FaImage, FaVideo, FaFilePdf, FaFileDownload, FaFileAlt, FaCheckSquare, FaTable } from 'react-icons/fa';
import * as FaIcons from 'react-icons/fa';
import { PasswordModal } from './PasswordModal';
import { IconPicker } from './IconPicker';
import ReactPlayer from 'react-player';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import TurndownService from 'turndown';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';

type CustomElement = { type: string; children: CustomText[]; url?: string; align?: string; checked?: boolean };
type CustomText = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; code?: boolean };

const sanitizeUrl = (url: string, type: 'link' | 'image' | 'video' = 'link'): string => {
  if (!url) return '';
  const trimmed = url.trim();
  // Always block javascript:
  if (trimmed.toLowerCase().startsWith('javascript:')) return '';
  if (trimmed.toLowerCase().startsWith('vbscript:')) return '';
  
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(protocol)) return trimmed;
    if (type === 'image' && protocol === 'data:') return trimmed; // Allow data URIs for images
    
    return ''; 
  } catch {
    // Likely relative URL or invalid. 
    // If it doesn't parse, we assume it's relative if it doesn't look like a script.
    return trimmed;
  }
};

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor & HistoryEditor;
    Element: CustomElement;
    Text: CustomText;
  }
}

const LIST_WRAPPERS = ['numbered-list', 'bulleted-list'];

const initialValue: Descendant[] = [
  {
    type: 'paragraph',
    children: [{ text: '' }],
  },
] as any;

const CustomEditor = {
  hasValidSelection(editor: Editor) {
    const { selection } = editor;
    if (!selection) return false;
    try {
      return (
        Editor.hasPath(editor, selection.anchor.path) &&
        Editor.hasPath(editor, selection.focus.path)
      );
    } catch {
      return false;
    }
  },
  ensureValidSelection(editor: Editor) {
    const { selection } = editor;
    if (!selection) return false;
    if (CustomEditor.hasValidSelection(editor)) return true;
    try {
      Transforms.select(editor, Editor.end(editor, []));
      return true;
    } catch {
      return false;
    }
  },
  isBoldMarkActive(editor: Editor) {
    try {
      const { selection } = editor;
      if (!selection || !CustomEditor.hasValidSelection(editor)) return false;
      const [match] = Editor.nodes(editor, {
        at: selection,
        match: n => Text.isText(n) && n.bold === true,
        universal: true,
      });
      return !!match;
    } catch {
      return false;
    }
  },
  isItalicMarkActive(editor: Editor) {
    try {
      const { selection } = editor;
      if (!selection || !CustomEditor.hasValidSelection(editor)) return false;
      const [match] = Editor.nodes(editor, {
        at: selection,
        match: n => Text.isText(n) && n.italic === true,
        universal: true,
      });
      return !!match;
    } catch {
      return false;
    }
  },
  isUnderlineMarkActive(editor: Editor) {
    try {
      const { selection } = editor;
      if (!selection || !CustomEditor.hasValidSelection(editor)) return false;
      const [match] = Editor.nodes(editor, {
        at: selection,
        match: n => Text.isText(n) && n.underline === true,
        universal: true,
      });
      return !!match;
    } catch {
      return false;
    }
  },
  isCodeMarkActive(editor: Editor) {
    try {
      const { selection } = editor;
      if (!selection || !CustomEditor.hasValidSelection(editor)) return false;
      const [match] = Editor.nodes(editor, {
        at: selection,
        match: n => Text.isText(n) && n.code === true,
        universal: true,
      });
      return !!match;
    } catch {
      return false;
    }
  },

  toggleBoldMark(editor: Editor) {
    const isActive = CustomEditor.isBoldMarkActive(editor);
    Transforms.setNodes(
      editor,
      { bold: isActive ? undefined : true },
      { match: n => Text.isText(n), split: true }
    );
  },
  toggleItalicMark(editor: Editor) {
    const isActive = CustomEditor.isItalicMarkActive(editor);
    Transforms.setNodes(
      editor,
      { italic: isActive ? undefined : true },
      { match: n => Text.isText(n), split: true }
    );
  },
  toggleUnderlineMark(editor: Editor) {
    const isActive = CustomEditor.isUnderlineMarkActive(editor);
    Transforms.setNodes(
      editor,
      { underline: isActive ? undefined : true },
      { match: n => Text.isText(n), split: true }
    );
  },
  toggleCodeMark(editor: Editor) {
    const isActive = CustomEditor.isCodeMarkActive(editor);
    Transforms.setNodes(
      editor,
      { code: isActive ? undefined : true },
      { match: n => Text.isText(n), split: true }
    );
  },

  isBlockActive(editor: Editor, format: string) {
    const { selection } = editor;
    if (!selection) return false;

    try {
      const [match] = Array.from(
        Editor.nodes(editor, {
          at: Editor.unhangRange(editor, selection),
          match: n =>
            !Editor.isEditor(n) &&
            SlateElement.isElement(n) &&
            (n as any).type === format,
        })
      );
      return !!match;
    } catch {
      return false;
    }
  },

  toggleBlock(editor: Editor, format: string) {
    const isActive = CustomEditor.isBlockActive(editor, format);
    const isListWrapper = LIST_WRAPPERS.includes(format);
    const isCheckList = format === 'check-list-item';

    Transforms.unwrapNodes(editor, {
      match: n =>
        !Editor.isEditor(n) &&
        SlateElement.isElement(n) &&
        LIST_WRAPPERS.includes((n as any).type),
      split: true,
    });

    let newProperties: Partial<SlateElement>;

    if (isCheckList) {
        newProperties = {
            type: isActive ? 'paragraph' : 'check-list-item',
            checked: isActive ? null : false 
        } as any;
    } else if (isListWrapper) {
        newProperties = {
            type: isActive ? 'paragraph' : 'list-item',
            checked: null
        } as any;
    } else {
        newProperties = {
            type: isActive ? 'paragraph' : format,
            checked: null
        } as any;
    }

    Transforms.setNodes<SlateElement>(editor, newProperties);

    if (!isActive && isListWrapper) {
      const block = { type: format, children: [] };
      Transforms.wrapNodes(editor, block);
    }
  },

  isLinkActive(editor: Editor) {
    try {
      const { selection } = editor;
      if (!selection || !CustomEditor.hasValidSelection(editor)) return false;
      const [link] = Editor.nodes(editor, {
        at: selection,
        match: n =>
          !Editor.isEditor(n) && SlateElement.isElement(n) && (n as any).type === 'link',
      });
      return !!link;
    } catch {
      return false;
    }
  },

  unwrapLink(editor: Editor) {
    try {
      if (!CustomEditor.ensureValidSelection(editor)) return;
      Transforms.unwrapNodes(editor, {
        match: n =>
          !Editor.isEditor(n) && SlateElement.isElement(n) && (n as any).type === 'link',
      });
    } catch {}
  },

  wrapLink(editor: Editor, url: string) {
    try {
      if (!CustomEditor.ensureValidSelection(editor)) return;
      if (CustomEditor.isLinkActive(editor)) {
        CustomEditor.unwrapLink(editor);
      }
      
      const sanitizedUrl = sanitizeUrl(url, 'link'); // Sanitize URL
      const { selection } = editor;
      const isCollapsed = selection && Range.isCollapsed(selection);
      const link: SlateElement = {
        type: 'link',
        url: sanitizedUrl,
        children: isCollapsed ? [{ text: sanitizedUrl }] : [],
      } as any;

      if (isCollapsed) {
        Transforms.insertNodes(editor, link);
      } else {
        Transforms.wrapNodes(editor, link, { split: true });
        Transforms.collapse(editor, { edge: 'end' });
      }
    } catch {}
  },

  insertImage(editor: Editor, url: string) {
    const text = { text: '' };
    const sanitizedUrl = sanitizeUrl(url, 'image');
    const image: SlateElement = { type: 'image', url: sanitizedUrl, children: [text] } as any;
    Transforms.insertNodes(editor, image);
  },

  insertVideo(editor: Editor, url: string) {
    const text = { text: '' };
    const sanitizedUrl = sanitizeUrl(url, 'video');
    const video: SlateElement = { type: 'video', url: sanitizedUrl, children: [text] } as any;
    Transforms.insertNodes(editor, video);
  },

  insertTable(editor: Editor) {
    const table: SlateElement = {
        type: 'table',
        children: [
            {
                type: 'table-row',
                children: [
                    { type: 'table-cell', children: [{ text: '' }] },
                    { type: 'table-cell', children: [{ text: '' }] },
                ]
            },
            {
                type: 'table-row',
                children: [
                    { type: 'table-cell', children: [{ text: '' }] },
                    { type: 'table-cell', children: [{ text: '' }] },
                ]
            }
        ]
    } as any;
    Transforms.insertNodes(editor, table);
  },
  getTableEntry(editor: Editor) {
    try {
      const { selection } = editor;
      if (!selection) return null;
      const cellEntry = Editor.above(editor, {
        at: selection,
        match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && (n as any).type === 'table-cell',
      });
      if (!cellEntry) return null;
      const [, cellPath] = cellEntry;
      const rowEntry = Editor.above(editor, {
        at: cellPath,
        match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && (n as any).type === 'table-row',
      });
      const tableEntry = Editor.above(editor, {
        at: cellPath,
        match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && (n as any).type === 'table',
      });
      if (!rowEntry || !tableEntry) return null;
      return { cellEntry, rowEntry, tableEntry };
    } catch {
      return null;
    }
  },
  isSelectionInTable(editor: Editor) {
    return !!CustomEditor.getTableEntry(editor);
  },
  addTableRow(editor: Editor) {
    const entry = CustomEditor.getTableEntry(editor);
    if (!entry) return;
    const [, rowPath] = entry.rowEntry;
    const [tableNode, tablePath] = entry.tableEntry as any;
    const tableRows = Array.isArray(tableNode.children) ? tableNode.children : [];
    const rawRowIndex = rowPath.length ? rowPath[rowPath.length - 1] : 0;
    const rowIndex = typeof rawRowIndex === 'number' ? rawRowIndex : 0;
    const refRow = tableRows[rowIndex] ?? tableRows[0];
    const colCount = Math.max(
      1,
      Array.isArray(refRow?.children) ? refRow.children.length : 1
    );
    const newRow: SlateElement = {
      type: 'table-row',
      children: Array.from({ length: colCount }, () => ({
        type: 'table-cell',
        children: [{ text: '' }],
      })),
    } as any;
    Transforms.insertNodes(editor, newRow, { at: tablePath.concat(rowIndex + 1) });
  },
  addTableColumn(editor: Editor) {
    const entry = CustomEditor.getTableEntry(editor);
    if (!entry) return;
    const [, cellPath] = entry.cellEntry;
    const [tableNode, tablePath] = entry.tableEntry as any;
    const tableRows = Array.isArray(tableNode.children) ? tableNode.children : [];
    const rawColIndex = cellPath.length ? cellPath[cellPath.length - 1] : 0;
    const colIndex = typeof rawColIndex === 'number' ? rawColIndex : 0;
    Editor.withoutNormalizing(editor, () => {
      tableRows.forEach((row: any, rowIndex: number) => {
        const rowPath = tablePath.concat(rowIndex);
        const rowChildren = Array.isArray(row?.children) ? row.children : [];
        const insertIndex = Math.min(colIndex + 1, rowChildren.length);
        const newCell: SlateElement = { type: 'table-cell', children: [{ text: '' }] } as any;
        Transforms.insertNodes(editor, newCell, { at: rowPath.concat(insertIndex) });
      });
    });
  },
  removeTableRow(editor: Editor) {
    const entry = CustomEditor.getTableEntry(editor);
    if (!entry) return;
    const [, rowPath] = entry.rowEntry;
    const [tableNode] = entry.tableEntry as any;
    const tableRows = Array.isArray(tableNode.children) ? tableNode.children : [];
    if (tableRows.length <= 1) return;
    Transforms.removeNodes(editor, { at: rowPath });
  },
  removeTableColumn(editor: Editor) {
    const entry = CustomEditor.getTableEntry(editor);
    if (!entry) return;
    const [, cellPath] = entry.cellEntry;
    const [tableNode, tablePath] = entry.tableEntry as any;
    const tableRows = Array.isArray(tableNode.children) ? tableNode.children : [];
    const rawColIndex = cellPath.length ? cellPath[cellPath.length - 1] : 0;
    const colIndex = typeof rawColIndex === 'number' ? rawColIndex : 0;
    const colCount = Math.max(
      1,
      ...tableRows.map((row: any) => (Array.isArray(row?.children) ? row.children.length : 0))
    );
    if (colCount <= 1) return;
    Editor.withoutNormalizing(editor, () => {
      tableRows.forEach((row: any, rowIndex: number) => {
        const rowChildren = Array.isArray(row?.children) ? row.children : [];
        if (rowChildren.length <= 1) return;
        const targetIndex = Math.min(colIndex, rowChildren.length - 1);
        const rowPath = tablePath.concat(rowIndex);
        Transforms.removeNodes(editor, { at: rowPath.concat(targetIndex) });
      });
    });
  },
};

const withEmbeds = (editor: Editor) => {
  const { isVoid } = editor;
  editor.isVoid = element => {
    return (element as any).type === 'image' || (element as any).type === 'video' ? true : isVoid(element);
  };
  return editor;
};

const stripHtml = (html: string) => {
  if (typeof window === 'undefined') return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
};

const escapeHtml = (input: string) =>
  input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const escapeAttr = (input: string) => escapeHtml(input);

const slateLeafToHtml = (leaf: any) => {
  if (!leaf || typeof leaf !== 'object' || typeof leaf.text !== 'string') return '';
  let html = escapeHtml(leaf.text || '');
  if (leaf.code) html = `<code>${html}</code>`;
  if (leaf.bold) html = `<strong>${html}</strong>`;
  if (leaf.italic) html = `<em>${html}</em>`;
  if (leaf.underline) html = `<u>${html}</u>`;
  return html;
};

const MAX_SLATE_DEPTH = 15;

const slateNodeToHtml = (node: any, depth = 0, visited = new WeakSet<object>()): string => {
  if (depth > MAX_SLATE_DEPTH) return '';
  if (!node) return '';
  
  if (typeof node === 'object') {
    if (visited.has(node)) return '';
    visited.add(node);
  }

  if (Array.isArray(node)) return node.map((child) => slateNodeToHtml(child, depth + 1, visited)).join('');
  if (Text.isText(node)) return slateLeafToHtml(node);
  if (typeof node !== 'object') return '';

  const type = typeof node.type === 'string' ? node.type : 'paragraph';
  const children = Array.isArray(node.children) ? node.children : [];
  const childrenHtml = children.map((child: any) => slateNodeToHtml(child, depth + 1, visited)).join('') || '';

  switch (type) {
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
      const checked = Boolean(node.checked);
      const input = `<input type="checkbox"${checked ? ' checked' : ''} />`;
      return `<li>${input}${childrenHtml}</li>`;
    }
    case 'link': {
      const url = typeof node.url === 'string' ? node.url : '';
      if (!url) return childrenHtml;
      return `<a href="${escapeAttr(sanitizeUrl(url, 'link'))}">${childrenHtml}</a>`;
    }
    case 'image': {
      const url = typeof node.url === 'string' ? node.url : '';
      if (!url) return '';
      return `<img src="${escapeAttr(sanitizeUrl(url, 'image'))}" alt="" />`;
    }
    case 'video': {
      const url = typeof node.url === 'string' ? node.url : '';
      if (!url) return '';
      return `<a href="${escapeAttr(sanitizeUrl(url, 'video'))}">${escapeHtml(url)}</a>`;
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
  const visited = new WeakSet<object>();
  if (!Array.isArray(value)) return slateNodeToHtml(value, 0, visited);

  let html = '';
  let checkItems: any[] = [];

  const flushCheckItems = () => {
    if (!checkItems.length) return;
    const itemsHtml = checkItems.map((node) => slateNodeToHtml(node, 0, visited)).join('');
    html += `<ul>${itemsHtml}</ul>`;
    checkItems = [];
  };

  for (const node of value) {
    if (node && typeof node === 'object' && node.type === 'check-list-item') {
      checkItems.push(node);
      continue;
    }
    flushCheckItems();
    html += slateNodeToHtml(node, 0, visited);
  }
  flushCheckItems();
  return html;
};

const MAX_TIPTAP_DEPTH = 50;

const tiptapJsonToHtml = (json: any, depth = 0, visited = new WeakSet<object>()): string => {
  if (!json) return '';
  if (depth > MAX_TIPTAP_DEPTH) return '';
  
  if (typeof json === 'object') {
      if (visited.has(json)) return '';
      visited.add(json);
  }

  if (Array.isArray(json)) return json.map((node) => tiptapJsonToHtml(node, depth + 1, visited)).join('');
  if (typeof json !== 'object') return '';

  if (json.type === 'doc' && Array.isArray(json.content)) {
    return json.content.map((node: any) => tiptapJsonToHtml(node, depth + 1, visited)).join('');
  }

  const content = Array.isArray(json.content) ? json.content.map((node: any) => tiptapJsonToHtml(node, depth + 1, visited)).join('') : '';

  switch (json.type) {
    case 'paragraph':
      return `<p>${content || '<br>'}</p>`;
    case 'heading': {
      const level = typeof json.attrs?.level === 'number' ? json.attrs.level : 1;
      const clamped = Math.max(1, Math.min(level, 6));
      return `<h${clamped}>${content}</h${clamped}>`;
    }
    case 'text': {
      let text = escapeHtml(String(json.text ?? ''));
      if (Array.isArray(json.marks)) {
        for (const mark of json.marks) {
          if (!mark || typeof mark !== 'object') continue;
          if (mark.type === 'bold') text = `<strong>${text}</strong>`;
          if (mark.type === 'italic') text = `<em>${text}</em>`;
          if (mark.type === 'underline') text = `<u>${text}</u>`;
          if (mark.type === 'strike') text = `<s>${text}</s>`;
          if (mark.type === 'link') {
            const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
            if (href) text = `<a href="${escapeAttr(sanitizeUrl(href, 'link'))}">${text}</a>`;
          }
        }
      }
      return text;
    }
    case 'bulletList':
      return `<ul>${content}</ul>`;
    case 'orderedList':
      return `<ol>${content}</ol>`;
    case 'listItem':
      return `<li>${content}</li>`;
    case 'taskList':
      return `<ul>${content}</ul>`;
    case 'taskItem': {
      const checked = Boolean(json.attrs?.checked);
      const input = `<input type="checkbox"${checked ? ' checked' : ''} />`;
      return `<li>${input}${content}</li>`;
    }
    case 'blockquote':
      return `<blockquote>${content}</blockquote>`;
    case 'codeBlock': {
      const raw = escapeHtml(String(json.text ?? ''));
      return `<pre><code>${raw || escapeHtml(stripHtml(content))}</code></pre>`;
    }
    case 'hardBreak':
      return '<br>';
    case 'image': {
      const src = typeof json.attrs?.src === 'string' ? json.attrs.src : '';
      const alt = typeof json.attrs?.alt === 'string' ? json.attrs.alt : '';
      if (!src) return '';
      return `<img src="${escapeAttr(sanitizeUrl(src, 'image'))}" alt="${escapeAttr(alt)}" />`;
    }
    case 'table':
      return `<table style="border-collapse: collapse; width: 100%; border: 1px solid #ddd;"><tbody>${content}</tbody></table>`;
    case 'tableRow':
      return `<tr>${content}</tr>`;
    case 'tableHeader':
      return `<th style="border: 1px solid #ddd; padding: 8px; background-color: #f2f2f2;">${content}</th>`;
    case 'tableCell':
      return `<td style="border: 1px solid #ddd; padding: 8px;">${content}</td>`;
    default:
      return content;
  }
};

const htmlToSlateValue = (html: string): Descendant[] => {
  if (typeof window === 'undefined') return initialValue;
  const doc = new DOMParser().parseFromString(html, 'text/html');

  const isElementNode = (n: Node): n is HTMLElement => n.nodeType === Node.ELEMENT_NODE;
  const isTextNode = (n: Node): n is globalThis.Text => n.nodeType === Node.TEXT_NODE;

  const ensureInlineChildren = (children: Descendant[]): any[] => {
    const flattened: any[] = [];
    for (const child of children) {
      if (!child) continue;
      if (Text.isText(child)) {
        flattened.push(child);
        continue;
      }
      if ((child as any).type === 'link') {
        flattened.push(child);
        continue;
      }
      if ((child as any).children && Array.isArray((child as any).children)) {
        flattened.push(...ensureInlineChildren((child as any).children));
      }
    }
    return flattened.length ? flattened : [{ text: '' }];
  };

  const deserialize = (node: Node, marks: Partial<CustomText>, depth = 0, visited = new WeakSet<Node>()): Descendant[] => {
    if (depth > MAX_SLATE_DEPTH) return [];

    // Circular reference check
    if (visited.has(node)) return [];
    visited.add(node);

    if (isTextNode(node)) {
      const text = node.textContent ?? '';
      if (!text) return [];
      if (/^[\t\n\r ]+$/.test(text)) return [];
      return [{ text, ...marks } as any];
    }
    if (!isElementNode(node)) return [];

    const el = node;
    const tag = el.nodeName.toLowerCase();

    let nextMarks: Partial<CustomText> = marks;
    if (tag === 'strong' || tag === 'b') nextMarks = { ...nextMarks, bold: true };
    if (tag === 'em' || tag === 'i') nextMarks = { ...nextMarks, italic: true };
    if (tag === 'u') nextMarks = { ...nextMarks, underline: true };
    if (tag === 'code') nextMarks = { ...nextMarks, code: true };

    if (tag === 'br') {
      const parent = el.parentElement;
      const parentTag = parent?.nodeName?.toLowerCase();
      const isLonelyBreak =
        parent &&
        (parentTag === 'p' || parentTag === 'div') &&
        parent.childNodes.length === 1 &&
        (parent.textContent ?? '') === '';

      if (isLonelyBreak) return [{ text: '', ...nextMarks } as any];
      if (parentTag === 'body') return [{ text: '', ...nextMarks } as any];

      const isTrailingBreak =
        parent &&
        (parentTag === 'p' || parentTag === 'div') &&
        parent.childNodes.length > 1 &&
        parent.lastChild === el;

      if (isTrailingBreak) return [{ text: '', ...nextMarks } as any];
      return [{ text: '\n', ...nextMarks } as any];
    }

    const children = Array.from(el.childNodes).flatMap((n) => deserialize(n, nextMarks, depth + 1, visited));

    if (tag === 'body' || tag === 'div' || tag === 'span') return children;

    if (tag === 'a') {
      const url = el.getAttribute('href') || '';
      if (!url) return children;
      return [
        {
          type: 'link',
          url: sanitizeUrl(url, 'link'),
          children: ensureInlineChildren(children),
        } as any,
      ];
    }

    if (tag === 'img') {
      const url = el.getAttribute('src') || '';
      if (!url) return [];
      return [{ type: 'image', url: sanitizeUrl(url, 'image'), children: [{ text: '' }] } as any];
    }

    if (tag === 'table') {
        const tbody = el.querySelector('tbody') || el;
        const rows = Array.from(tbody.children).filter(c => c.nodeName.toLowerCase() === 'tr');
        const children = rows.map(r => ({
            type: 'table-row',
            children: Array.from(r.children).flatMap(c => deserialize(c, marks, depth + 1, visited))
        }));
        return [{ type: 'table', children } as any];
    }

    if (tag === 'tr') {
        return [{ type: 'table-row', children: Array.from(el.children).flatMap(c => deserialize(c, marks, depth + 1, visited)) } as any];
    }

    if (tag === 'td' || tag === 'th') {
        const children = ensureInlineChildren(Array.from(el.childNodes).flatMap(n => deserialize(n, marks, depth + 1, visited)));
        return [{ type: 'table-cell', children } as any];
    }

    if (tag === 'iframe' || tag === 'video') {
      const url =
        el.getAttribute('src') ||
        (tag === 'video' ? (el.querySelector('source')?.getAttribute('src') ?? '') : '');
      if (!url) return [];
      return [{ type: 'video', url: sanitizeUrl(url, 'video'), children: [{ text: '' }] } as any];
    }

    if (tag === 'h1') return [{ type: 'heading-one', children: ensureInlineChildren(children) } as any];
    if (tag === 'h2') return [{ type: 'heading-two', children: ensureInlineChildren(children) } as any];

    if (tag === 'blockquote') return [{ type: 'block-quote', children: ensureInlineChildren(children) } as any];

    if (tag === 'pre') {
      const text = el.textContent ?? '';
      return [{ type: 'paragraph', children: [{ text, ...marks, code: true }] } as any];
    }

    if (tag === 'p') return [{ type: 'paragraph', children: ensureInlineChildren(children) } as any];

    if (tag === 'ul' || tag === 'ol') {
      const items = Array.from(el.children).filter((c) => c.nodeName.toLowerCase() === 'li') as HTMLElement[];
      const hasCheckbox =
        el.getAttribute('data-checked') === 'true' ||
        items.some((li) => {
          if (li.querySelector('input[type="checkbox"]')) return true;
          const quillList = li.getAttribute('data-list');
          if (quillList === 'checked' || quillList === 'unchecked') return true;
          const attr = li.getAttribute('data-checked');
          if (attr === 'true' || attr === 'false') return true;
          return false;
        });

      if (hasCheckbox) {
        return items.map((li) => {
          const input = li.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
          const quillList = li.getAttribute('data-list');
          const checked =
            (input ? input.checked || input.hasAttribute('checked') : false) ||
            quillList === 'checked' ||
            li.getAttribute('data-checked') === 'true';
          const childNodes = Array.from(li.childNodes).filter(
            (n) => !(n as any).nodeName || (n as any).nodeName.toLowerCase() !== 'input'
          );
          const inline = ensureInlineChildren(childNodes.flatMap((n) => deserialize(n, marks, depth + 1, visited)));
          return { type: 'check-list-item', checked, children: inline } as any;
        });
      }

      const wrapperType = tag === 'ol' ? 'numbered-list' : 'bulleted-list';
      const listChildren = items.map((li) => ({
        type: 'list-item',
        children: ensureInlineChildren(Array.from(li.childNodes).flatMap((n) => deserialize(n, marks, depth + 1, visited))),
      }));
      return [{ type: wrapperType, children: listChildren } as any];
    }

    if (tag === 'li') return [{ type: 'list-item', children: ensureInlineChildren(children) } as any];

    return children;
  };

  const topLevel = Array.from(doc.body.childNodes).flatMap((n) => deserialize(n, {}, 0));
  const blocks = topLevel.filter(Boolean) as Descendant[];
  return blocks.length ? blocks : initialValue;
};

const isRecord = (v: unknown): v is Record<string, any> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const extractTextFromSlateLike = (v: unknown, depth = 0, visited?: WeakSet<object>): string => {
  if (depth > MAX_SLATE_DEPTH) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map((n) => extractTextFromSlateLike(n, depth + 1, visited)).join('');
  if (!isRecord(v)) return '';
  const set = visited ?? new WeakSet<object>();
  if (set.has(v)) return '';
  set.add(v);
  if (typeof v.text === 'string') return v.text;
  const children = (v.children ?? (v as any).childr33en) as unknown;
  return extractTextFromSlateLike(children, depth + 1, set);
};

const normalizeSlateValue = (input: unknown, fallbackText?: string): Descendant[] => {
  const normalizeText = (node: Record<string, any>): CustomText => {
    const next: CustomText = {
      text: typeof node.text === 'string' ? node.text : String(node.text ?? ''),
    };
    if (node.bold === true) next.bold = true;
    if (node.italic === true) next.italic = true;
    if (node.underline === true) next.underline = true;
    if (node.code === true) next.code = true;
    return next;
  };

  const normalizeDescendant = (node: unknown, depth = 0, visited = new WeakSet<object>()): Descendant | null => {
    if (depth > MAX_SLATE_DEPTH) return null;
    if (!isRecord(node)) return null;
    if (visited.has(node)) return null;
    visited.add(node);

    if ('text' in node) return normalizeText(node) as any;

    const type = typeof node.type === 'string' ? node.type : 'paragraph';
    const rawChildren = Array.isArray(node.children)
      ? node.children
      : Array.isArray((node as any).childr33en)
        ? (node as any).childr33en
        : [];

    const children = rawChildren.map(c => normalizeDescendant(c, depth + 1, visited)).filter(Boolean) as Descendant[];
    const safeChildren = children.length ? children : ([{ text: '' }] as any);

    const element: any = { type, children: safeChildren };
    if (typeof node.url === 'string') element.url = node.url;
    if (typeof node.align === 'string') element.align = node.align;
    if (node.checked === true || node.checked === false) element.checked = node.checked;
    return element as Descendant;
  };

  const asArray = Array.isArray(input) ? input : isRecord(input) ? [input] : [];
  const normalized = asArray
    .map((n) => normalizeDescendant(n))
    .filter(Boolean)
    .map((n) => (Text.isText(n as any) ? ({ type: 'paragraph', children: [n] } as any) : n)) as Descendant[];

  if (normalized.length) return normalized;

  const text = fallbackText?.trim() ? fallbackText.trim() : '';
  if (text) return [{ type: 'paragraph', children: [{ text }] } as any];
  return initialValue;
};

const contentToSlateValue = (raw: string): Descendant[] => {
  if (!raw) return initialValue;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && (parsed as any).type === 'doc' && Array.isArray((parsed as any).content)) {
      const fromHtml = htmlToSlateValue(tiptapJsonToHtml(parsed));
      return normalizeSlateValue(fromHtml, extractTextFromSlateLike(fromHtml));
    }
    return normalizeSlateValue(parsed, extractTextFromSlateLike(parsed));
  } catch {
    if (raw && /<\/?[a-z][\s\S]*>/i.test(raw)) {
      const fromHtml = htmlToSlateValue(raw);
      return normalizeSlateValue(fromHtml, stripHtml(raw));
    }
    return normalizeSlateValue(undefined, raw);
  }
};

const ToolbarButton = ({ format, icon, active, onMouseDown }: any) => (
  <button
    onMouseDown={onMouseDown}
    className={`p-2 rounded hover:bg-gray-200 dark:hover:bg-gray-700 ${
      active ? 'text-blue-600 dark:text-blue-400 bg-gray-200 dark:bg-gray-700' : 'text-gray-600 dark:text-gray-400'
    }`}
    title={format}
    aria-label={format}
  >
    {icon}
  </button>
);

const Toolbar = () => {
  const editor = useSlate();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const { t } = useTranslation();
  const isInTable = CustomEditor.isSelectionInTable(editor);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        CustomEditor.insertImage(editor, url);
      };
      reader.readAsDataURL(file);
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mb-4 p-2 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
      <ToolbarButton
        format={t('noteEditor.toolbar.bold')}
        icon={<FaBold />}
        active={CustomEditor.isBoldMarkActive(editor)}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleBoldMark(editor);
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.italic')}
        icon={<FaItalic />}
        active={CustomEditor.isItalicMarkActive(editor)}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleItalicMark(editor);
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.underline')}
        icon={<FaUnderline />}
        active={CustomEditor.isUnderlineMarkActive(editor)}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleUnderlineMark(editor);
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.code')}
        icon={<FaCode />}
        active={CustomEditor.isCodeMarkActive(editor)}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleCodeMark(editor);
        }}
      />
      
      <ToolbarButton
        format={t('noteEditor.toolbar.table')}
        icon={<FaTable />}
        active={false}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.insertTable(editor);
        }}
      />
      {isInTable && (
        <>
          <ToolbarButton
            format={t('noteEditor.toolbar.tableAddRow')}
            icon={<span className="font-bold text-xs">R+</span>}
            active={false}
            onMouseDown={(event: any) => {
              event.preventDefault();
              CustomEditor.addTableRow(editor);
            }}
          />
          <ToolbarButton
            format={t('noteEditor.toolbar.tableRemoveRow')}
            icon={<span className="font-bold text-xs">R-</span>}
            active={false}
            onMouseDown={(event: any) => {
              event.preventDefault();
              CustomEditor.removeTableRow(editor);
            }}
          />
          <ToolbarButton
            format={t('noteEditor.toolbar.tableAddColumn')}
            icon={<span className="font-bold text-xs">C+</span>}
            active={false}
            onMouseDown={(event: any) => {
              event.preventDefault();
              CustomEditor.addTableColumn(editor);
            }}
          />
          <ToolbarButton
            format={t('noteEditor.toolbar.tableRemoveColumn')}
            icon={<span className="font-bold text-xs">C-</span>}
            active={false}
            onMouseDown={(event: any) => {
              event.preventDefault();
              CustomEditor.removeTableColumn(editor);
            }}
          />
        </>
      )}

      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2" />

      <ToolbarButton
        format={t('noteEditor.toolbar.heading1')}
        icon={<span className="font-bold text-sm">H1</span>}
        active={CustomEditor.isBlockActive(editor, 'heading-one')}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleBlock(editor, 'heading-one');
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.heading2')}
        icon={<span className="font-bold text-sm">H2</span>}
        active={CustomEditor.isBlockActive(editor, 'heading-two')}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleBlock(editor, 'heading-two');
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.quote')}
        icon={<FaQuoteRight />}
        active={CustomEditor.isBlockActive(editor, 'block-quote')}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleBlock(editor, 'block-quote');
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.bulletedList')}
        icon={<FaListUl />}
        active={CustomEditor.isBlockActive(editor, 'bulleted-list')}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleBlock(editor, 'bulleted-list');
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.numberedList')}
        icon={<FaListOl />}
        active={CustomEditor.isBlockActive(editor, 'numbered-list')}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleBlock(editor, 'numbered-list');
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.checkList')}
        icon={<FaCheckSquare />}
        active={CustomEditor.isBlockActive(editor, 'check-list-item')}
        onMouseDown={(event: any) => {
          event.preventDefault();
          CustomEditor.toggleBlock(editor, 'check-list-item');
        }}
      />

      <div className="w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2" />

      <ToolbarButton
        format={t('noteEditor.toolbar.link')}
        icon={<FaLink />}
        active={CustomEditor.isLinkActive(editor)}
        onMouseDown={(event: any) => {
          event.preventDefault();
          const url = window.prompt(t('noteEditor.prompts.linkUrl'));
          if (!url) return;
          CustomEditor.wrapLink(editor, url);
        }}
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.image')}
        icon={<FaImage />}
        onMouseDown={(event: any) => {
          event.preventDefault();
          fileInputRef.current?.click();
        }}
      />
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleImageUpload}
        className="hidden"
        accept="image/*"
      />
      <ToolbarButton
        format={t('noteEditor.toolbar.video')}
        icon={<FaVideo />}
        onMouseDown={(event: any) => {
          event.preventDefault();
          const url = window.prompt(t('noteEditor.prompts.videoUrl'));
          if (url) CustomEditor.insertVideo(editor, url);
        }}
      />
    </div>
  );
};

const withHtml = (editor: Editor) => {
  const { insertData } = editor;

  editor.insertData = (data: DataTransfer) => {
    const html = data.getData('text/html');

    if (html) {
      const fragment = htmlToSlateValue(html);
      
      // Avoid inserting empty paragraphs if parsing failed or result is empty
      const isDefault =
        fragment.length === 1 &&
        SlateElement.isElement(fragment[0]) &&
        (fragment[0] as any).type === 'paragraph' &&
        Array.isArray((fragment[0] as any).children) &&
        (fragment[0] as any).children.length === 1 &&
        Text.isText((fragment[0] as any).children[0]) &&
        ((fragment[0] as any).children[0] as any).text === '';
      
      if (!isDefault) {
        Transforms.insertFragment(editor, fragment);
        return;
      }
    }

    insertData(data);
  };

  return editor;
};

export default function NoteEditor() {
  const { selectedNoteId, notes, updateNote, unlockNote, joinNote, leaveNote, activeUsers, user } = useStore();
  const editor = useMemo(() => withHtml(withEmbeds(withHistory(withReact(createEditor())))), []);
  const { t } = useTranslation();

  const selectedNote = notes.find((n) => n._id === selectedNoteId);
  const [title, setTitle] = useState('');
  const [value, setValue] = useState<Descendant[]>(initialValue);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [showIconPicker, setShowIconPicker] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [isUnlockedLocally, setIsUnlockedLocally] = useState(false);

  const isEffectiveLocked = useMemo(() => {
    if (!selectedNote) return false;
    if (selectedNote.locked) return true;
    let parentId = selectedNote.parentId;
    let depth = 0;
    while (parentId && depth < 500) {
      const p = notes.find(n => n._id === parentId);
      if (!p) break;
      if (p.locked) return true;
      parentId = p.parentId;
      depth += 1;
    }
    return false;
  }, [selectedNote, notes]);

  const saveTitle = useMemo(
    () =>
      debounce((id: string, title: string, content: string) => {
        updateNote(id, title, content);
      }, 500),
    [updateNote]
  );
  const lastSavedContentRef = useRef<string>(slateValueToHtml(initialValue));
  const lastSavedTitleRef = useRef<string>(selectedNote?.title || '');
  const currentTitleRef = useRef<string>('');

  // Reset local unlock state when switching notes
  useEffect(() => {
    setIsUnlockedLocally(false);
    setIsPasswordModalOpen(false);
    setShowIconPicker(false);
  }, [selectedNoteId]);

  const previousNoteIdRef = useRef<string | null>(null);
  const loadedAfterUnlockRef = useRef(false);

  useEffect(() => {
    if (!selectedNoteId) return;
    const note = notes.find(n => n._id === selectedNoteId);
    if (!note) return;

    const shouldLoad =
      previousNoteIdRef.current !== selectedNoteId ||
      (isUnlockedLocally && !loadedAfterUnlockRef.current);

    if (!shouldLoad) return;

    let newValue = initialValue;
    
    // Check locked status for content loading
    const isLocked = (() => {
      if (note.locked) return true;
      let pId = note.parentId;
      let depth = 0;
      while (pId && depth < 500) {
        const p = notes.find(n => n._id === pId);
        if (!p) break;
        if (p.locked) return true;
        pId = p.parentId;
        depth += 1;
      }
      return false;
    })();

    if (isLocked && !note.content && !isUnlockedLocally) {
        newValue = initialValue;
    } else {
        newValue = contentToSlateValue(note.content || '');
    }

    setValue(newValue);
    lastSavedContentRef.current = slateValueToHtml(newValue);
    lastSavedTitleRef.current = note.title || '';
    currentTitleRef.current = note.title || '';
    setTitle(note.title || '');
    previousNoteIdRef.current = selectedNoteId;
    loadedAfterUnlockRef.current = isUnlockedLocally;
  }, [notes, selectedNoteId, isUnlockedLocally]);

  useEffect(() => {
    if (!selectedNoteId) return;
    if (isEffectiveLocked && !isUnlockedLocally && !selectedNote?.content) return;
    requestAnimationFrame(() => {
      try {
        Transforms.select(editor, Editor.end(editor, []));
        ReactEditor.focus(editor);
      } catch {}
    });
  }, [editor, isEffectiveLocked, isUnlockedLocally, selectedNote?.content, selectedNoteId]);

  useEffect(() => {
    return () => {
      saveTitle.cancel();
    };
  }, [saveTitle, selectedNoteId]);

  const renderLeaf = useCallback((props: any) => <Leaf {...props} />, []);
  const renderElement = useCallback((props: any) => <Element {...props} />, []);

  // Focus editor when clicking on the container
  const focusEditor = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      Transforms.select(editor, Editor.end(editor, []));
      ReactEditor.focus(editor);
    }
  };

  const handleUnlock = async (password: string) => {
    if (!selectedNote) return;
    const success = await unlockNote(selectedNote._id, password);
    if (success) {
      setIsUnlockedLocally(true);
      // The store update will trigger useEffect to populate content
    } else {
      throw new Error('Incorrect password');
    }
  };

  const handleLock = async (password: string) => {
    if (!selectedNote) return;
    await updateNote(selectedNote._id, currentTitleRef.current, lastSavedContentRef.current, true, password);
    setIsLocking(false);
  };

  const handleExportPDF = async () => {
    const element = document.querySelector('[data-slate-editor="true"]') as HTMLElement;
    if (!element) return;
    
    try {
      const canvas = await html2canvas(element);
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF();
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${selectedNote?.title || 'note'}.pdf`);
    } catch (error) {
      console.error('Export PDF failed:', error);
    }
  };

  const handleExportMarkdown = async () => {
    const element = document.querySelector('[data-slate-editor="true"]') as HTMLElement;
    if (!element) return;
    
    try {
      const TurndownService = (await import('turndown')).default;
      const turndownService = new TurndownService();
      // Keep headings, code blocks etc
      turndownService.addRule('codeBlock', {
        filter: 'pre',
        replacement: function (content, node) {
          return '\n```\n' + content + '\n```\n';
        }
      });
      
      const markdown = turndownService.turndown(element.innerHTML);
      
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedNote?.title || 'note'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export Markdown failed:', error);
    }
  };

  if (!selectedNote) {
    return (
      <div className="flex items-center justify-center h-full text-gray-600 dark:text-gray-400">
        {t('noteEditor.selectNote')}
      </div>
    );
  }

  if (isEffectiveLocked && !isUnlockedLocally && !selectedNote.content) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-600 dark:text-gray-400 gap-4">
        <FaLock size={48} className="text-gray-500" />
        <h2 className="text-2xl font-bold text-gray-700 dark:text-gray-300">{t('noteEditor.lockedTitle')}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-400">
             {selectedNote.locked ? t('noteEditor.lockedPasswordProtected') : t('noteEditor.lockedInherited')}
        </p>
        <button
          onClick={() => setIsPasswordModalOpen(true)}
          className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          {t('noteEditor.unlockNote')}
        </button>
        
        <PasswordModal
          isOpen={isPasswordModalOpen}
          onClose={() => setIsPasswordModalOpen(false)}
          onSubmit={handleUnlock}
          title={t('noteEditor.unlockNoteTitle')}
        />
      </div>
    );
  }

  const onChange = (newValue: Descendant[]) => {
    setValue(newValue);
  };

  // Debounced save effect
  useEffect(() => {
    const handler = setTimeout(() => {
        if (!selectedNote || !selectedNote._id) return;
        
        const serialized = slateValueToHtml(value);
        if (serialized === lastSavedContentRef.current) return;
        
        lastSavedContentRef.current = serialized;
        
        // Use the direct updateNote function, not the debounced saveNote wrapper
        // since we are already debouncing via setTimeout
        updateNote(selectedNote._id, currentTitleRef.current, serialized);
    }, 1000);

    return () => clearTimeout(handler);
  }, [value, selectedNote, updateNote]);

  const onTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextTitle = e.target.value;
    if (nextTitle === currentTitleRef.current) return;
    setTitle(nextTitle);
    currentTitleRef.current = nextTitle;
    lastSavedTitleRef.current = nextTitle;
    saveTitle(selectedNote._id, nextTitle, lastSavedContentRef.current);
  };

  const Icon = selectedNote.icon && (FaIcons as any)[selectedNote.icon] 
      ? (FaIcons as any)[selectedNote.icon] 
      : FaFileAlt;

  return (
    <div className="flex flex-col h-full p-8 w-full bg-white dark:bg-gray-900">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center flex-1 min-w-0 mr-4">
             {currentActiveUsers.length > 0 && (
                 <div className="flex items-center gap-1 mr-4 -space-x-2 hover:space-x-1 transition-all">
                     {currentActiveUsers.map((u, i) => (
                         <div 
                            key={u._id || i} 
                            className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold border-2 border-white dark:border-gray-800 shadow-sm" 
                            title={u.username}
                         >
                             {u.username.substring(0, 2).toUpperCase()}
                         </div>
                     ))}
                 </div>
             )}
             <button 
                 onClick={() => setShowIconPicker(true)} 
                 className="p-2 mr-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors flex-shrink-0"
                 title={t('noteEditor.changeIcon')}
             >
                 <Icon size={28} />
             </button>
            <input
              type="text"
              value={title}
              onChange={onTitleChange}
              className="text-4xl font-bold bg-transparent border-none outline-none placeholder-gray-400 text-gray-900 dark:text-gray-100 flex-1 min-w-0"
              placeholder={t('common.untitled')}
            />
        </div>
        
        {showIconPicker && (
             <IconPicker 
                 onSelect={(icon) => {
                     updateNote(selectedNote._id, currentTitleRef.current, lastSavedContentRef.current, selectedNote.locked, undefined, icon);
                     setShowIconPicker(false);
                 }}
                 onClose={() => setShowIconPicker(false)}
             />
        )}

        <div className="flex gap-2">
          <button
            onClick={handleExportPDF}
            className="p-2 text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            title={t('noteEditor.exportPdf')}
          >
            <FaFilePdf size={20} />
          </button>
          <button
            onClick={handleExportMarkdown}
            className="p-2 text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            title={t('noteEditor.exportMarkdown')}
          >
            <FaFileDownload size={20} />
          </button>
          <button
            onClick={() => {
              if (selectedNote.locked) {
                // If already locked (and we are viewing it, so we must have unlocked it), allow re-locking?
                // Actually, if it's locked in DB, we just want to allow "Locking" if it's NOT locked.
                // To remove lock, we might need another flow. For now, let's just support Adding Lock.
                // If it's already locked, we can maybe Remove Lock?
                if (confirm(t('noteEditor.removeLockConfirm'))) {
                   updateNote(selectedNote._id, currentTitleRef.current, lastSavedContentRef.current, false, '');
                }
              } else {
                setIsLocking(true);
                setIsPasswordModalOpen(true);
              }
            }}
            className="p-2 text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            title={selectedNote.locked ? t('noteEditor.unlockRemovePassword') : t('noteEditor.lockNote')}
          >
            {selectedNote.locked ? <FaUnlock size={20} /> : <FaLock size={20} />}
          </button>
        </div>
      </div>
      
      <Slate key={`${selectedNoteId}:${isUnlockedLocally ? 'u' : 'l'}`} editor={editor} initialValue={loadedValue} onChange={onChange}>
        <Toolbar />
        <div 
            className="flex-1 overflow-y-auto w-full cursor-text" 
            onClick={focusEditor}
        >
          <Editable
            renderLeaf={renderLeaf}
            renderElement={renderElement}
            className="prose dark:prose-invert prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-li:my-0 prose-headings:my-2 max-w-none w-full focus:outline-none min-h-full leading-snug"
            placeholder={t('noteEditor.startTyping')}
            onKeyDown={event => {
              const { selection } = editor;

              // Handle Enter in checklist
              if (event.key === 'Enter' && selection && Range.isCollapsed(selection)) {
                const [match] = Editor.nodes(editor, {
                  match: n => !Editor.isEditor(n) && SlateElement.isElement(n) && (n as any).type === 'check-list-item',
                });

                if (match) {
                  const [node, path] = match;
                  
                  // If empty, convert to paragraph (break out of list)
                  if (Editor.string(editor, path) === '') {
                    event.preventDefault();
                    Transforms.setNodes(editor, { type: 'paragraph', checked: null } as any);
                    return;
                  }

                  // Split node and ensure new item is unchecked
                  event.preventDefault();
                  Transforms.splitNodes(editor, { always: true });
                  Transforms.setNodes(editor, { checked: false } as any);
                  return;
                }
              }

              if (!event.ctrlKey) {
                return;
              }

              switch (event.key) {
                case 'b': {
                  event.preventDefault();
                  CustomEditor.toggleBoldMark(editor);
                  break;
                }
                case 'i': {
                  event.preventDefault();
                  CustomEditor.toggleItalicMark(editor);
                  break;
                }
                case 'u': {
                  event.preventDefault();
                  CustomEditor.toggleUnderlineMark(editor);
                  break;
                }
                case '`': {
                  event.preventDefault();
                  CustomEditor.toggleCodeMark(editor);
                  break;
                }
              }
            }}
          />
        </div>
      </Slate>

      <PasswordModal
        isOpen={isPasswordModalOpen}
        onClose={() => { setIsPasswordModalOpen(false); setIsLocking(false); }}
        onSubmit={isLocking ? handleLock : handleUnlock}
        title={isLocking ? t('noteEditor.setLockPasswordTitle') : t('noteEditor.unlockNoteTitle')}
        isCreatingLock={isLocking}
      />
    </div>
  );
}

const CheckListItemElement = ({ attributes, children, element }: any) => {
  const editor = useSlateStatic();
  const readOnly = useReadOnly();
  const { checked } = element;

  return (
    <div {...attributes} className="flex flex-row items-start space-x-2 my-1">
      <span
        contentEditable={false}
        className="mr-2 mt-1 cursor-pointer select-none"
        onMouseDown={e => {
            e.preventDefault();
            if (readOnly) return;
            const path = ReactEditor.findPath(editor, element);
            const newProperties: Partial<CustomElement> = {
                checked: !checked,
            };
            Transforms.setNodes(editor, newProperties, { at: path });
        }}
      >
        <input 
            type="checkbox" 
            checked={!!checked} 
            readOnly
            className="h-4 w-4 cursor-pointer" 
        />
      </span>
      <div className={`flex-1 ${checked ? 'line-through text-gray-600 dark:text-gray-500' : ''}`}>
        {children}
      </div>
    </div>
  );
};

const Leaf = ({ attributes, children, leaf }: any) => {
  if (leaf.bold) {
    children = <strong>{children}</strong>;
  }
  if (leaf.code) {
    children = <code className="bg-gray-200 dark:bg-gray-700 rounded px-1">{children}</code>;
  }
  if (leaf.italic) {
    children = <em>{children}</em>;
  }
  if (leaf.underline) {
    children = <u>{children}</u>;
  }

  return <span {...attributes}>{children}</span>;
};

const Element = ({ attributes, children, element }: any) => {
  switch (element.type) {
    case 'block-quote':
      return <blockquote {...attributes} className="border-l-4 border-gray-300 pl-4 italic my-4 text-gray-700 dark:text-gray-300">{children}</blockquote>;
    case 'bulleted-list':
      return <ul {...attributes} className="list-disc list-inside my-4 pl-4">{children}</ul>;
    case 'numbered-list':
      return <ol {...attributes} className="list-decimal list-inside my-4 pl-4">{children}</ol>;
    case 'check-list-item':
      return <CheckListItemElement {...attributes} element={element}>{children}</CheckListItemElement>;
    case 'list-item':
      return <li {...attributes} className="mb-1">{children}</li>;
    case 'heading-one':
      return <h1 {...attributes} className="text-3xl font-bold mt-6 mb-4">{children}</h1>;
    case 'heading-two':
      return <h2 {...attributes} className="text-2xl font-bold mt-5 mb-3">{children}</h2>;
    case 'link':
      return (
        <a {...attributes} href={element.url} className="text-blue-500 hover:text-blue-700 underline cursor-pointer" target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    case 'image':
      return (
        <div {...attributes} className="my-4">
          <div contentEditable={false}>
            <img src={element.url} className="max-w-full h-auto rounded shadow-lg" alt="Embedded" />
          </div>
          {children}
        </div>
      );
    case 'video':
      return (
        <div {...attributes} className="my-4">
          <div contentEditable={false} className="relative pt-[56.25%] bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
            <ReactPlayer
              url={element.url}
              className="absolute top-0 left-0"
              width="100%"
              height="100%"
              controls
            />
          </div>
          {children}
        </div>
      );
    case 'code':
      return (
        <pre {...attributes} className="bg-gray-800 text-white p-4 rounded my-4 overflow-x-auto">
          <code>{children}</code>
        </pre>
      );
    case 'table':
        return (
            <div className="overflow-x-auto my-4">
                <table {...attributes} className="min-w-full border-collapse border border-gray-300 dark:border-gray-700">
                    <tbody>{children}</tbody>
                </table>
            </div>
        );
    case 'table-row':
        return <tr {...attributes} className="border-b border-gray-300 dark:border-gray-700">{children}</tr>;
    case 'table-cell':
        return <td {...attributes} className="border border-gray-300 dark:border-gray-700 p-2 min-w-[50px]">{children}</td>;
    default:
      return <p {...attributes} className="mb-2">{children}</p>;
  }
};
