/* The reading view for documents that are not PDFs (text, Markdown, screenplays, Word, Rich Text, OpenDocument,
   ebooks): one comfortable column, your text size, light or dark page, find, a contents list from the headings,
   and Save as PDF through the browser's print.
   WHERE THE DOCUMENT IS SHOWN, AND WHY. Each document gets its own <iframe sandbox="allow-same-origin allow-modals">.
   Without "allow-scripts" the browser runs no script inside that frame at all: not a <script>, not an onerror=, not
   a javascript: link, whatever slipped past sanitize.js. The frame also carries its own, stricter
   Content-Security-Policy (no connections, pictures only from blob:/data:, styles only from this app's doc.css),
   and it cannot open windows or move this page. "allow-same-origin" lets this page (not the document) reach in to
   place the cleaned content, find text and scroll; it gives the document nothing, because the document cannot run
   code. A shadow root was the other choice: it isolates styles but not scripts, so the sanitiser and the CSP would
   have been the only two locks; the frame adds a third that does not depend on our own lists being right.
   "allow-modals" is there only so the frame can be printed. */
import { convert, canRead, KINDS, extOf } from './formats.js';
import { droppedLine } from './sanitize.js';

const $ = s => document.querySelector(s);
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
const CSS_URL = new URL('doc.css', import.meta.url).href;
const SHELL = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src 'self'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="${CSS_URL}"></head><body><main id="doc"></main></body></html>`;

export const texts = new Map(); // id -> { id, name, handle, kind, label, frame, doc, outline, note, blobs, find }
export { canRead };
let hooks = { toast() {}, changed() {}, appKey() {} }, front = null, seq = 0;
const set = LS.get('reader:text', { size: 100, theme: 'auto', outline: false });
const saveSet = () => LS.set('reader:text', set);

function applyLook(t) {
  const r = t.doc.documentElement; r.dataset.theme = set.theme; r.style.setProperty('--size', (set.size / 100 * 18).toFixed(2) + 'px');
}
function drawLook() {
  $('#tvSize').textContent = set.size + '%';
  $('#tvSmaller').disabled = set.size <= 70; $('#tvBigger').disabled = set.size >= 220;
  const names = { auto: 'Page: as the app', light: 'Page: light', dark: 'Page: dark' };
  $('#tvTheme').textContent = names[set.theme];
  $('#tvOutlineBtn').setAttribute('aria-expanded', String(!!set.outline)); $('#tvOutline').hidden = !set.outline;
  for (const t of texts.values()) applyLook(t);
}

/* ---------- contents (from the book's own list, else from the headings) ---------- */
function buildOutline(t, given) {
  const out = [];
  if (given) for (const g of given) { const e = t.doc.getElementById(g.id); if (e) out.push({ level: g.level, text: g.text, el: e }); }
  if (!out.length) { let n = 0; for (const h of t.doc.querySelectorAll('h1:not(.f-title), h2, h3, h4')) { const text = h.textContent.trim().replace(/\s+/g, ' '); if (text) out.push({ level: +h.tagName[1], text: text.slice(0, 140), el: h }); if (++n > 3000) break; } }
  const top = Math.min(...out.map(o => o.level)); for (const o of out) o.level = Math.min(4, o.level - top + 1);
  t.outline = out;
}
function drawOutline() {
  const t = texts.get(front), box = $('#tvOutline'); box.textContent = '';
  if (!t) return;
  const h = document.createElement('div'); h.className = 'lbl'; h.textContent = t.kind === 'fountain' ? 'Scenes' : 'Contents'; box.appendChild(h);
  if (!t.outline.length) { const p = document.createElement('p'); p.className = 'none'; p.textContent = 'This document has no headings to list.'; box.appendChild(p); return; }
  t.outline.forEach((o, k) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'lv' + o.level; b.textContent = o.text; b.dataset.k = k; box.appendChild(b); });
  markHere(t);
}
function markHere(t) {
  if (t.id !== front || $('#tvOutline').hidden || !t.outline.length) return;
  let k = 0; for (let i = 0; i < t.outline.length; i++) { if (t.outline[i].el.getBoundingClientRect().top <= 90) k = i; else break; }
  const btns = $('#tvOutline').querySelectorAll('button'); btns.forEach((b, i) => { if (i === k) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
}

/* ---------- find ---------- */
const BLOCK = /^(P|DIV|LI|H[1-6]|TD|TH|PRE|BLOCKQUOTE|DT|DD|FIGCAPTION|CAPTION|TR|BR)$/;
function indexOf(t) {
  if (t.index) return t.index;
  const w = t.doc.createTreeWalker(t.doc.getElementById('doc'), NodeFilter.SHOW_TEXT), nodes = []; let text = '', last = null, n;
  while ((n = w.nextNode())) {
    let b = n.parentNode; while (b && !BLOCK.test(b.nodeName)) b = b.parentNode;
    if (b !== last && text) text += '\n'; last = b;
    nodes.push({ node: n, at: text.length }); text += n.nodeValue;
  }
  const low = text.toLowerCase();
  return (t.index = { text: low.length === text.length ? low : text, folded: low.length === text.length, nodes });
}
function place(ix, pos, end) { // which text node holds this position
  let a = 0, b = ix.nodes.length - 1;
  while (a < b) { const m = (a + b + 1) >> 1; if (ix.nodes[m].at <= pos) a = m; else b = m - 1; }
  if (end) while (a > 0 && ix.nodes[a].at === pos) a--; // an end exactly on a boundary belongs to the node before
  return { node: ix.nodes[a].node, off: Math.min(pos - ix.nodes[a].at, ix.nodes[a].node.nodeValue.length) };
}
function find(q, step = 0) {
  const t = texts.get(front); if (!t) return;
  const w = t.frame.contentWindow, hl = w.CSS && w.CSS.highlights, f = t.find;
  if (q !== f.q) {
    f.q = q; f.ranges = []; f.at = 0;
    if (q) {
      const ix = indexOf(t), needle = ix.folded ? q.toLowerCase() : q; let p = 0;
      while ((p = ix.text.indexOf(needle, p)) >= 0 && f.ranges.length < 5000) {
        const a = place(ix, p), b = place(ix, p + needle.length, true), r = t.doc.createRange();
        try { r.setStart(a.node, a.off); r.setEnd(b.node, b.off); f.ranges.push(r); } catch (e) {}
        p += needle.length;
      }
    }
  } else if (f.ranges.length) f.at = (f.at + step + f.ranges.length) % f.ranges.length;
  if (hl) { hl.delete('found'); hl.delete('found-now'); if (f.ranges.length) { hl.set('found', new w.Highlight(...f.ranges)); hl.set('found-now', new w.Highlight(f.ranges[f.at])); } }
  const cur = f.ranges[f.at];
  if (cur) {
    const rc = cur.getBoundingClientRect(); if (rc.top < 60 || rc.bottom > w.innerHeight - 40) w.scrollBy({ top: rc.top - w.innerHeight / 3 });
    if (!hl) { const s = w.getSelection(); s.removeAllRanges(); s.addRange(cur); }
  }
  $('#tvFindN').textContent = !q ? '' : f.ranges.length ? `${f.at + 1} of ${f.ranges.length}${f.ranges.length >= 5000 ? '+' : ''}` : 'Not found';
  $('#tvPrev').disabled = $('#tvNext').disabled = f.ranges.length < 2;
}

/* ---------- printing (Save as PDF) ---------- */
export function printText() {
  const t = texts.get(front); if (!t) return;
  hooks.toast('In the print window, choose “Save as PDF” (or “Microsoft Print to PDF”) as the printer.', 6000);
  setTimeout(() => { try { t.frame.contentWindow.focus(); t.frame.contentWindow.print(); } catch (e) { hooks.toast('The browser would not open its print window for this document.', 6000); } }, 60);
}

/* ---------- keys: the same whether the page or the document has the keyboard ---------- */
function keys(e) {
  if (!front) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); const i = $('#tvFind'); i.focus(); i.select(); }
  else if (ctrl && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); printText(); }
  else if (e.key === 'F3' || (ctrl && (e.key === 'g' || e.key === 'G'))) { e.preventDefault(); find($('#tvFind').value, e.shiftKey ? -1 : 1); }
}

/* ---------- open, show, close ---------- */
export async function openText(file, handle) {
  const id = 'text-' + (++seq), frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals'); frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.title = file.name; frame.hidden = true; frame.srcdoc = SHELL;
  const loaded = new Promise((res, rej) => { frame.addEventListener('load', res, { once: true }); setTimeout(() => rej(new Error('the reading page did not start')), 15000); });
  $('#tvFrames').appendChild(frame);
  let conv;
  try {
    await loaded;
    const doc = frame.contentDocument;
    conv = await convert(file, doc);
    doc.getElementById('doc').appendChild(conv.frag);
    doc.documentElement.dataset.kind = conv.kind; doc.title = conv.title || file.name;
    const t = { id, name: file.name, handle: handle || null, kind: conv.kind, label: conv.label, title: conv.title, frame, doc, blobs: conv.blobs, outline: [], count: conv.count, find: { q: '', ranges: [], at: 0 }, index: null,
      dropped: droppedLine(conv.count), notes: conv.notes, noteShut: false, words: (doc.getElementById('doc').textContent.match(/\S+/g) || []).length };
    buildOutline(t, conv.outline); applyLook(t);
    doc.addEventListener('click', e => { // links: inside the document we scroll; outside goes through the app's "open this link?" question
      const a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
      e.preventDefault(); const h = a.getAttribute('href');
      if (h.startsWith('#')) { const to = doc.getElementById(h.slice(1)); if (to) to.scrollIntoView({ block: 'start' }); else hooks.toast('That link points to a place this document does not have.'); }
      else if (a.dataset.out) window.open(h);
    });
    doc.addEventListener('auxclick', e => { if (e.target.closest && e.target.closest('a[href]')) e.preventDefault(); });
    doc.addEventListener('keydown', e => { keys(e); if (!e.defaultPrevented) hooks.appKey(e); });
    texts.set(id, t); hooks.changed();
    return id;
  } catch (e) { frame.remove(); if (conv) for (const u of conv.blobs) URL.revokeObjectURL(u); throw e; }
}
export function showText(id) { // null: no text document is in front
  front = id && texts.has(id) ? id : null;
  for (const t of texts.values()) t.frame.hidden = t.id !== front;
  $('#textview').hidden = !front;
  const t = texts.get(front); if (!t) return;
  const note = $('#tvNote'), parts = [t.dropped, ...t.notes].filter(Boolean);
  note.hidden = !parts.length || t.noteShut; note.textContent = '';
  if (t.dropped) { const b = document.createElement('p'); b.className = 'safe'; b.textContent = t.dropped; note.appendChild(b); }
  if (t.notes.length) { const p = document.createElement('p'); p.textContent = t.notes.join(' '); note.appendChild(p); }
  const x = document.createElement('button'); x.type = 'button'; x.className = 'btn'; x.textContent = 'Hide'; x.title = 'Hide this note'; x.addEventListener('click', () => { t.noteShut = true; note.hidden = true; }); note.appendChild(x);
  $('#tvFind').value = t.find.q; find(t.find.q);
  drawOutline(); drawLook();
}
export function closeText(id) {
  const t = texts.get(id); if (!t) return;
  for (const u of t.blobs) URL.revokeObjectURL(u);
  t.frame.remove(); texts.delete(id); if (front === id) { front = null; $('#textview').hidden = true; }
  hooks.changed();
}
export const frontText = () => front;

export function initText(h) {
  hooks = { ...hooks, ...h };
  if (matchMedia('(max-width: 760px)').matches) set.outline = false; // on a phone the list covers the page: closed until asked for
  $('#tvSmaller').addEventListener('click', () => { set.size = Math.max(70, set.size - 10); saveSet(); drawLook(); });
  $('#tvBigger').addEventListener('click', () => { set.size = Math.min(220, set.size + 10); saveSet(); drawLook(); });
  $('#tvTheme').addEventListener('click', () => { set.theme = { auto: 'light', light: 'dark', dark: 'auto' }[set.theme]; saveSet(); drawLook(); });
  $('#tvOutlineBtn').addEventListener('click', () => { set.outline = !set.outline; saveSet(); drawLook(); drawOutline(); });
  $('#tvOutline').addEventListener('click', e => { const b = e.target.closest('button[data-k]'), t = texts.get(front); if (!b || !t) return; t.outline[+b.dataset.k].el.scrollIntoView({ block: 'start' }); if (matchMedia('(max-width: 760px)').matches) { set.outline = false; drawLook(); } });
  $('#tvPdf').addEventListener('click', printText);
  const fi = $('#tvFind'); let ft = 0;
  fi.addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => find(fi.value), 120); });
  fi.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); clearTimeout(ft); find(fi.value, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); fi.value = ''; find(''); texts.get(front)?.frame.focus(); }
  });
  $('#tvPrev').addEventListener('click', () => find(fi.value, -1));
  $('#tvNext').addEventListener('click', () => find(fi.value, 1));
  addEventListener('keydown', keys, true);
  // where you are in the contents list: looked up a few times a second while the list is open (a frame that runs no scripts sends this page no scroll events)
  let lastY = -1; setInterval(() => { const t = texts.get(front); if (!t || $('#tvOutline').hidden) return; const y = t.frame.contentWindow.scrollY; if (y !== lastY) { lastY = y; markHere(t); } }, 250);
  drawLook();
}
export { KINDS, extOf };
