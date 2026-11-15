/* Turning a document that is not a PDF into something to read: plain text, Markdown, Fountain screenplays, Word
   (.docx), Rich Text (.rtf), OpenDocument (.odt) and ebooks (.epub).
   Each reader below returns { title, frag, count, notes, outline?, blobs } where frag is a tree of plain reading
   elements built in the reading frame's own document. Text, Fountain and RTF are read by the code here and built
   element by element from the words alone, so no markup from the file is ever parsed as markup. Markdown, Word,
   OpenDocument and ebooks carry markup, links and pictures: those go through sanitize.js, which copies across only
   what is on its lists. Zip-based files are unpacked by zip.js, which refuses zip bombs.
   Libraries (in ../vendor, unmodified, each with its licence): marked 18.2.0 (MIT) for Markdown; mammoth 1.13.0
   (BSD-2-Clause) for Word. Fountain, RTF, OpenDocument and ePub are read by the code in this file. */
import { openZip, storedCopy, Refused } from './zip.js';
import { sanitize, inert, newCount } from './sanitize.js';

export const KINDS = { txt: 'Text', text: 'Text', log: 'Text', md: 'Markdown', markdown: 'Markdown', fountain: 'Screenplay', spmd: 'Screenplay', docx: 'Word', rtf: 'Rich Text', odt: 'OpenDocument', epub: 'Ebook' };
export const extOf = name => (/\.([a-z0-9]+)$/i.exec(name || '')?.[1] || '').toLowerCase();
export const canRead = name => extOf(name) in KINDS;
const MAX_TEXT = 60 * 1024 * 1024;

function decodeText(u8) {
  if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return new TextDecoder('windows-1252').decode(u8); }
}
const el = (out, tag, cls, text) => { const e = out.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml' };
// pictures inside a zip package, as addresses only this page can use
async function pictures(tmp, zip, pathOf, blobs) {
  const map = new Map();
  for (const im of tmp.querySelectorAll('img[src]')) {
    const s = im.getAttribute('src'); if (map.has(s) || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(s)) continue;
    const path = pathOf(s, im), type = MIME[extOf(path || '')]; let url = null;
    if (path && type && zip.has(path)) { const b = await zip.bytes(path); url = URL.createObjectURL(new Blob([b], { type })); blobs.push(url); }
    map.set(s, url);
  }
  return s => map.get(s) || null;
}

/* ---------- plain text ---------- */
function readTxt(text, out) {
  const frag = out.createDocumentFragment();
  for (const block of text.replace(/\r\n?/g, '\n').split(/\n{2,}/)) if (block.trim()) frag.appendChild(el(out, 'p', 't-pre', block.replace(/^\n+|\s+$/g, '')));
  return { frag, classes: true };
}

/* ---------- Markdown (marked) ---------- */
async function readMd(text, out, count) {
  const { marked } = await import('../vendor/marked/marked.esm.js');
  text = text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n/, ''); // front matter is for programs, not readers
  const d = inert(marked.parse(text, { gfm: true, async: false }));
  for (const box of d.querySelectorAll('input[type=checkbox]')) box.replaceWith(d.createTextNode(box.hasAttribute('checked') ? '☑ ' : '☐ '));
  return { frag: sanitize(d.body, out, { count }) };
}

/* ---------- Fountain (screenplays; fountain.io syntax 1.1) ---------- */
function emphasis(out, into, text) { // ***bold italic***, **bold**, *italic*, _underline_, \* for a real star
  const re = /(\\[*_])|(\*\*\*)(?=\S)([\s\S]*?\S)\*\*\*|(\*\*)(?=\S)([\s\S]*?\S)\*\*|(\*)(?=\S)([\s\S]*?\S)\*|(_)(?=\S)([\s\S]*?\S)_/g;
  let at = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > at) into.appendChild(out.createTextNode(text.slice(at, m.index)));
    if (m[1]) into.appendChild(out.createTextNode(m[1][1]));
    else if (m[2]) { const b = el(out, 'b'), i = el(out, 'i'); b.appendChild(i); emphasis(out, i, m[3]); into.appendChild(b); }
    else if (m[4]) { const b = el(out, 'b'); emphasis(out, b, m[5]); into.appendChild(b); }
    else if (m[6]) { const i = el(out, 'i'); emphasis(out, i, m[7]); into.appendChild(i); }
    else { const u = el(out, 'u'); emphasis(out, u, m[9]); into.appendChild(u); }
    at = re.lastIndex;
  }
  if (at < text.length) into.appendChild(out.createTextNode(text.slice(at)));
}
export function readFountain(text, out) {
  const frag = out.createDocumentFragment(), add = (tag, cls, t, into = frag) => { const e = el(out, tag, cls); emphasis(out, e, t); into.appendChild(e); return e; };
  text = text.replace(/\r\n?/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, ''); // boneyard and notes are the writer's, not the reader's
  let lines = text.split('\n'), title = '', k = 0;
  if (/^[A-Za-z][A-Za-z ]*:/.test(lines[0] || '')) { // title page: "Key: value" lines up to the first blank line
    const tp = {}; let key = null;
    for (; k < lines.length && lines[k].trim(); k++) {
      const m = /^([A-Za-z][A-Za-z ]*):\s*(.*)$/.exec(lines[k]);
      if (m && !/^\s/.test(lines[k])) { key = m[1].toLowerCase(); tp[key] = m[2] ? [m[2]] : []; } else if (key) tp[key].push(lines[k].trim());
    }
    const page = el(out, 'div', 'f-titlepage'), plain = s => s.replace(/[*_]/g, '');
    if (tp.title) { title = plain(tp.title.join(' ')); const h = el(out, 'h1', 'f-title'); tp.title.forEach((t, i) => { if (i) h.appendChild(out.createElement('br')); emphasis(out, h, t); }); page.appendChild(h); }
    for (const key2 of ['credit', 'author', 'authors', 'source']) if (tp[key2]) add('p', 'f-credit', tp[key2].join('\n'), page);
    const foot = ['draft date', 'date', 'contact', 'copyright', 'notes', 'revision'].filter(x => tp[x]).map(x => tp[x].join('\n'));
    if (foot.length) add('p', 'f-contact', foot.join('\n'), page);
    if (page.childNodes.length) frag.appendChild(page);
  }
  lines = lines.slice(k);
  const blank = i => i < 0 || i >= lines.length || !lines[i].trim();
  let lastDlg = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i], t = raw.trim();
    if (!t) continue;
    const alone = blank(i - 1) && blank(i + 1);
    if (/^={3,}$/.test(t)) { frag.appendChild(el(out, 'hr', 'f-pb')); continue; }
    if (/^#{1,6}\s*\S/.test(t)) { const n = /^#+/.exec(t)[0].length; add('h' + Math.min(n, 2), 'f-section', t.replace(/^#+\s*/, '')); continue; }
    if (/^=(?!=)/.test(t)) { add('p', 'f-synopsis', t.slice(1).trim()); continue; }
    const forcedScene = /^\.[^.]/.test(t);
    if (forcedScene || (alone && /^(INT|EXT|EST|INT\.?\/EXT|I\/E)[. ]/i.test(t))) {
      const m = /^(.*?)\s*#([\w.-]+)#\s*$/.exec(forcedScene ? t.slice(1) : t), h = add('h3', 'f-scene', (m ? m[1] : forcedScene ? t.slice(1) : t).toUpperCase());
      if (m) h.dataset.n = m[2];
      lastDlg = null; continue;
    }
    if (/^>.*<$/.test(t)) { add('p', 'f-center', t.slice(1, -1).trim()); continue; }
    if (t.startsWith('>') || (alone && t === t.toUpperCase() && /TO:$/.test(t))) { add('p', 'f-trans', t.replace(/^>\s*/, '')); lastDlg = null; continue; }
    if (t.startsWith('~')) { add('p', 'f-lyric', t.slice(1).trim()); continue; }
    const forcedChar = t.startsWith('@'), name = t.replace(/\s*\^$/, '').replace(/\s*\([^)]*\)\s*$/, '');
    if (!t.startsWith('!') && blank(i - 1) && !blank(i + 1) && (forcedChar || (/[A-Z]/.test(name) && name === name.toUpperCase() && !/[a-z]/.test(name)))) {
      const dual = /\^$/.test(t), box = el(out, 'div', 'f-dialogue');
      add('p', 'f-char', t.replace(/^@/, '').replace(/\s*\^$/, ''), box);
      for (i++; i < lines.length && lines[i].trim(); i++) {
        const d = lines[i].trim();
        if (/^\(.*\)$/.test(d)) add('p', 'f-paren', d, box); else if (d.startsWith('~')) add('p', 'f-lyric', d.slice(1).trim(), box); else add('p', 'f-speech', d, box);
      }
      if (dual && lastDlg && lastDlg.parentNode) { // two people talking at once: side by side
        let pair = lastDlg.parentNode.className === 'f-dual' ? lastDlg.parentNode : null;
        if (!pair) { pair = el(out, 'div', 'f-dual'); lastDlg.replaceWith(pair); pair.appendChild(lastDlg); }
        pair.appendChild(box);
      } else frag.appendChild(box);
      lastDlg = box; continue;
    }
    let block = raw.replace(/^\s*!/, ''); // action: lines that follow belong to the same paragraph
    while (!blank(i + 1) && !/^(={3,}|#|>|~|\.[^.]|@)/.test(lines[i + 1].trim())) block += '\n' + lines[++i];
    add('p', 'f-action', block); lastDlg = null;
  }
  return { frag, title, classes: true };
}

/* ---------- Rich Text (.rtf): the words, bold/italic/underline, headings by style name, simple tables ---------- */
export function parseRtf(u8) {
  let s = ''; for (let i = 0; i < u8.length; i += 65536) s += String.fromCharCode.apply(null, u8.subarray(i, i + 65536));
  if (!/^\s*\{\\rtf/.test(s)) throw new Refused('This file is not Rich Text inside, whatever its name says. It may be a Word file saved with the wrong ending.');
  const SKIP = new Set('fonttbl colortbl info pict object header footer headerl headerr headerf footerl footerr footerf footnote fldinst datafield themedata colorschememapping latentstyles datastore generator xmlnstbl listtable listoverridetable rsidtbl pgdsctbl revtbl nonshppict shpinst bkmkstart bkmkend filetbl annotation atnid atnauthor comment xe tc template operator author'.split(' '));
  const CH = { emdash: '—', endash: '–', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', bullet: '•', tab: '\t', emspace: ' ', enspace: ' ', qmspace: ' ', line: '\n', '~': '\u00A0', _: '\u2011' };
  const fresh = () => ({ b: false, i: false, u: false, strike: false, sup: false, sub: false, hid: false });
  let st = { ...fresh(), uc: 1, skip: false, dest: '' }, stack = [], cp = 1252, dec = null, bytes = [], skipN = 0, star = false;
  const blocks = [], styles = new Map(); let para = null, table = null, row = null, cell = null, intbl = false, pstyle = null, align = '', title = '', pics = 0, notes = 0, ss = null;
  const decoder = () => dec || (dec = (() => { try { return new TextDecoder(cp === 10000 ? 'macintosh' : cp === 65001 ? 'utf-8' : 'windows-' + cp); } catch (e) { return new TextDecoder('windows-1252'); } })());
  const flush = () => { if (bytes.length) { const t = decoder().decode(new Uint8Array(bytes)); bytes = []; emit(t); } };
  function emit(t) {
    if (!t) return;
    if (st.dest === 'title') { title += t; return; }
    if (st.dest === 'stylesheet') { if (ss) ss.name += t; return; }
    if (st.skip || st.hid) return;
    if (!para) para = { runs: [], style: pstyle, align };
    const last = para.runs[para.runs.length - 1], f = (st.b ? 1 : 0) | (st.i ? 2 : 0) | (st.u ? 4 : 0) | (st.strike ? 8 : 0) | (st.sup ? 16 : 0) | (st.sub ? 32 : 0);
    if (last && last.f === f) last.t += t; else para.runs.push({ t, f });
  }
  function endPara(force) {
    const p = para || (force ? { runs: [], style: pstyle, align } : null); para = null;
    if (!p) return;
    if (intbl) { (cell ||= []).push(p); return; }
    if (table) { blocks.push(table); table = null; row = null; cell = null; }
    blocks.push({ type: 'p', ...p });
  }
  const N = s.length; let i = 0;
  while (i < N) {
    const c = s[i];
    if (c === '{') { flush(); stack.push({ ...st }); if (st.dest === 'stylesheet') ss = { n: 0, name: '' }; i++; continue; }
    if (c === '}') {
      flush();
      if (st.dest === 'stylesheet' && ss) { styles.set(ss.n, ss.name.replace(/;\s*$/, '').trim()); ss = null; }
      st = stack.pop() || st; star = false; i++; continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') {
      if (skipN > 0) { skipN--; i++; continue; }
      const code = s.charCodeAt(i);
      if (code > 127) bytes.push(code); else { flush(); let j = i + 1; while (j < N && !/[\\{}\r\n]/.test(s[j]) && s.charCodeAt(j) < 128) j++; emit(s.slice(i, j)); i = j - 1; }
      i++; continue;
    }
    const n = s[i + 1];
    if (n === "'") { const b = parseInt(s.substr(i + 2, 2), 16); i += 4; if (skipN > 0) { skipN--; continue; } if (!Number.isNaN(b)) bytes.push(b); continue; }
    if (!/[a-zA-Z]/.test(n || '')) { // a control symbol
      flush(); i += 2;
      if (n === '*') star = true;
      else if (n === '\n' || n === '\r') endPara(true);
      else if (n === '\\' || n === '{' || n === '}') emit(n);
      else if (CH[n]) emit(CH[n]);
      continue;
    }
    const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(s.slice(i + 1, i + 60)), w = m[1], has = m[2] != null, v = has ? parseInt(m[2], 10) : 1;
    i += 1 + m[0].length;
    if (w === 'u' && has) { flush(); emit(String.fromCodePoint(v < 0 ? v + 65536 : v)); skipN = st.uc; continue; }
    flush();
    if (w === 'bin') { i += Math.max(0, v); continue; }
    if (w === 'stylesheet') { st.dest = 'stylesheet'; st.skip = true; star = false; continue; }
    if (w === 'title' && stack.length && stack[stack.length - 1].dest === 'info') { st.dest = 'title'; continue; }
    if (SKIP.has(w)) { if (w === 'pict' && !st.skip) pics++; if (w === 'footnote' && !st.skip) notes++; st.skip = true; st.dest = w; star = false; continue; }
    if (star) { star = false; if (!['shppict', 'listtext', 'pntext', 'ud', 'upr'].includes(w)) { st.skip = true; st.dest = w; continue; } }
    if (st.dest === 'stylesheet') { if (w === 's' && ss) ss.n = v; continue; }
    if (st.skip) continue;
    switch (w) {
      case 'par': case 'sect': endPara(true); break;
      case 'pard': if (st.dest !== 'listtext') { intbl = false; pstyle = null; align = ''; } break;
      case 'plain': Object.assign(st, fresh()); break;
      case 'listtext': case 'pntext': st.dest = 'listtext'; break;
      case 'b': st.b = v !== 0; break; case 'i': st.i = v !== 0; break; case 'strike': st.strike = v !== 0; break; case 'v': st.hid = v !== 0; break;
      case 'ul': case 'uld': case 'uldb': case 'ulw': case 'uldash': case 'ulth': case 'ulwave': st.u = v !== 0; break; case 'ulnone': st.u = false; break;
      case 'super': st.sup = true; st.sub = false; break; case 'sub': st.sub = true; st.sup = false; break; case 'nosupersub': st.sup = st.sub = false; break;
      case 'uc': st.uc = v; break; case 'ansicpg': cp = v; dec = null; break; case 'mac': cp = 10000; dec = null; break;
      case 's': pstyle = v; if (para) para.style = v; break;
      case 'qc': align = 'c'; if (para) para.align = 'c'; break; case 'qr': align = 'r'; if (para) para.align = 'r'; break; case 'ql': case 'qj': align = ''; if (para) para.align = ''; break;
      case 'intbl': intbl = true; break;
      case 'cell': { const p = para; para = null; (cell ||= []); if (p) cell.push(p); (row ||= []).push(cell); cell = null; break; }
      case 'row': { if (cell && cell.length) (row ||= []).push(cell); cell = null; if (row) { (table ||= { type: 'table', rows: [] }).rows.push(row); row = null; } intbl = false; break; }
      case 'page': break;
      default: if (CH[w]) emit(CH[w]);
    }
  }
  flush(); endPara(false); if (table) blocks.push(table);
  return { blocks, styles, title: title.trim(), pics, notes };
}
function readRtf(u8, out) {
  const r = parseRtf(u8), frag = out.createDocumentFragment();
  const runs = (p, into) => { for (const run of p.runs) { let host = into; for (const [bit, tag] of [[1, 'b'], [2, 'i'], [4, 'u'], [8, 's'], [16, 'sup'], [32, 'sub']]) if (run.f & bit) { const e = out.createElement(tag); host.appendChild(e); host = e; } run.t.split('\n').forEach((t, k) => { if (k) host.appendChild(out.createElement('br')); if (t) host.appendChild(out.createTextNode(t)); }); } };
  const block = (p, into) => {
    const name = r.styles.get(p.style) || '', h = /^heading (\d)$/i.exec(name), tag = h ? 'h' + Math.min(6, +h[1]) : /^title$/i.test(name) ? 'h1' : 'p';
    const e = el(out, tag, p.align === 'c' ? 'al-c' : p.align === 'r' ? 'al-r' : ''); runs(p, e); if (!e.childNodes.length && tag !== 'p') return; if (!e.childNodes.length) e.className = 'gap'; into.appendChild(e);
  };
  for (const b of r.blocks) {
    if (b.type === 'p') { block(b, frag); continue; }
    const t = el(out, 'table'), body = el(out, 'tbody'); t.appendChild(body);
    for (const row of b.rows) { const tr = el(out, 'tr'); for (const c of row) { const td = el(out, 'td'); for (const p of c) { if (c.length === 1) runs(p, td); else block(p, td); } tr.appendChild(td); } body.appendChild(tr); }
    frag.appendChild(t);
  }
  const notes = ['Rich Text is shown for reading: the words, bold, italic and underline, headings and simple tables. Fonts, colours, page layout and anything inside text boxes may differ from the original.'];
  if (r.pics) notes.push(r.pics === 1 ? '1 picture in this file is not shown.' : `${r.pics} pictures in this file are not shown.`);
  if (r.notes) notes.push(r.notes === 1 ? '1 footnote is not shown.' : `${r.notes} footnotes are not shown.`);
  return { frag, title: r.title, notes, classes: true };
}

/* ---------- Word (.docx) through mammoth ---------- */
let mammothP = null;
const mammoth = () => mammothP ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = new URL('../vendor/mammoth/mammoth.browser.min.js', import.meta.url).href;
  s.onload = () => window.mammoth ? res(window.mammoth) : rej(new Error('the Word reader did not start')); s.onerror = () => { mammothP = null; rej(new Error('the Word reader could not be loaded (it is part of this app: reload the page and try again)')); };
  document.head.appendChild(s);
});
async function readDocx(buffer, out, count) {
  const zip = await openZip(buffer);
  if (!zip.has('word/document.xml')) throw new Refused(zip.has('content.xml') ? 'This file is an OpenDocument file with a Word ending. Rename it to .odt and open it again.' : 'This file is not a Word document inside (it has no word/document.xml). It may be damaged.');
  // pictures and links that point outside the file: counted, and taken out before the Word reader sees them
  const relsName = 'word/_rels/document.xml.rels', enc = new TextEncoder(); let rels = await zip.text(relsName), swap = null;
  if (rels) {
    const fixed = rels.replace(/<Relationship\b[^>]*>/g, tag => {
      if (!/TargetMode\s*=\s*"External"/i.test(tag)) return tag;
      if (/Type\s*=\s*"[^"]*\/image"/i.test(tag)) { count.remote++; return tag.replace(/Target\s*=\s*"[^"]*"/i, 'Target="about:blank"'); }
      if (/Type\s*=\s*"[^"]*\/(attachedTemplate|oleObject|frame|subDocument|externalLink[^"]*)"/i.test(tag)) { count.remoteOther++; return tag.replace(/Target\s*=\s*"[^"]*"/i, 'Target="about:blank"'); }
      return tag;
    });
    if (fixed !== rels) swap = enc.encode(fixed);
  }
  const safe = { names: zip.names, bytes: async n => (n === relsName && swap) ? swap : zip.bytes(n) };
  const copy = await storedCopy(safe), m = await mammoth();
  const r = await m.convertToHtml({ arrayBuffer: copy }, { includeDefaultStyleMap: true });
  const d = inert(r.value);
  const frag = sanitize(d.body, out, { count });
  const notes = ['Word documents are shown for reading: the words, headings, lists, tables, pictures, footnotes and links are here. Page layout, fonts, colours, columns, headers and footers, text boxes and tracked changes are not, so it will not look as it does in Word.'];
  let core = null; try { core = await zip.text('docProps/core.xml'); } catch (e) {}
  const title = core ? (/<dc:title>([^<]*)<\/dc:title>/.exec(core)?.[1] || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim() : '';
  return { frag, notes, title };
}

/* ---------- OpenDocument Text (.odt): content.xml read here ---------- */
async function readOdt(buffer, out, count, blobs) {
  const zip = await openZip(buffer);
  if (!zip.has('content.xml')) throw new Refused(zip.has('word/document.xml') ? 'This file is a Word document with an OpenDocument ending. Rename it to .docx and open it again.' : 'This file is not an OpenDocument text file inside (it has no content.xml). It may be damaged.');
  const man = zip.has('META-INF/manifest.xml') ? await zip.text('META-INF/manifest.xml') : '';
  if (/encryption-data/.test(man)) throw new Refused('This file is locked with a password. Open it in LibreOffice or the program that made it, save it without the password, and try again.');
  const x = new DOMParser().parseFromString(await zip.text('content.xml'), 'application/xml');
  if (x.getElementsByTagName('parsererror').length) throw new Refused('This file is damaged: its text could not be read.');
  const A = (e, n) => { for (const a of e.attributes) if (a.localName === n) return a.value; return null; };
  const fmt = new Map(), numbered = new Set();
  for (const s of x.getElementsByTagName('*')) {
    if (s.localName === 'style') { const tp = [...s.children].find(c => c.localName === 'text-properties'), parent = A(s, 'parent-style-name') || ''; fmt.set(A(s, 'name'), { b: tp && /bold|[6-9]00/.test(A(tp, 'font-weight') || ''), i: tp && /italic|oblique/.test(A(tp, 'font-style') || ''), u: tp && !!A(tp, 'text-underline-style') && A(tp, 'text-underline-style') !== 'none', s: tp && !!A(tp, 'text-line-through-style') && A(tp, 'text-line-through-style') !== 'none', title: /^Title$/i.test(parent) || /^Title$/i.test(A(s, 'name') || '') }); }
    if (s.localName === 'list-style' && [...s.children][0]?.localName === 'list-level-style-number') numbered.add(A(s, 'name'));
  }
  const tmp = document.implementation.createHTMLDocument(''), body = tmp.body; let pics = 0, listStyle = null;
  const mk = (t, into) => into.appendChild(tmp.createElement(t));
  function inline(node, into) {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { into.appendChild(tmp.createTextNode(c.nodeValue)); continue; }
      if (c.nodeType !== 1) continue;
      const n = c.localName;
      if (n === 's') into.appendChild(tmp.createTextNode('\u00A0'.repeat(Math.min(200, +(A(c, 'c') || 1)))));
      else if (n === 'tab') into.appendChild(tmp.createTextNode('\t'));
      else if (n === 'line-break') mk('br', into);
      else if (n === 'span') { const f = fmt.get(A(c, 'style-name')) || {}; let host = into; for (const [on, tag] of [[f.b, 'b'], [f.i, 'i'], [f.u, 'u'], [f.s, 's']]) if (on) host = mk(tag, host); inline(c, host); }
      else if (n === 'a') { const a = mk('a', into); a.setAttribute('href', A(c, 'href') || ''); inline(c, a); }
      else if (n === 'frame') { const im = [...c.children].find(k => k.localName === 'image'); if (im) { const g = mk('img', into); g.setAttribute('src', A(im, 'href') || ''); const alt = [...c.children].find(k => k.localName === 'desc' || k.localName === 'title'); if (alt) g.setAttribute('alt', alt.textContent); pics++; } else for (const k of c.children) if (k.localName === 'text-box') blockKids(k, into.closest('p,h1,h2,h3,h4,h5,h6') ? body : into); }
      else if (n === 'note') { const nb = [...c.children].find(k => k.localName === 'note-body'); const sm = mk('small', into); sm.appendChild(tmp.createTextNode(' [note: ' + (nb ? nb.textContent.trim() : '') + '] ')); }
      else if (n === 'bookmark' || n === 'bookmark-start') { const sp = mk('span', into); sp.setAttribute('id', A(c, 'name') || ''); }
      else if (/^(annotation|annotation-end|change|change-start|change-end|soft-page-break|bookmark-end|reference-mark.*)$/.test(n)) continue;
      else inline(c, into);
    }
  }
  function blockKids(node, into) {
    for (const c of node.children) {
      const n = c.localName;
      if (n === 'h') inline(c, mk('h' + Math.max(1, Math.min(6, +(A(c, 'outline-level') || 1))), into));
      else if (n === 'p') inline(c, mk(fmt.get(A(c, 'style-name'))?.title || A(c, 'style-name') === 'Title' ? 'h1' : 'p', into));
      else if (n === 'list') { const was = listStyle; listStyle = A(c, 'style-name') || listStyle; const l = mk(numbered.has(listStyle) ? 'ol' : 'ul', into); for (const it of c.children) if (it.localName === 'list-item' || it.localName === 'list-header') blockKids(it, mk('li', l)); listStyle = was; }
      else if (n === 'table') { const t = mk('table', into), tb = mk('tbody', t); const rows = k => { for (const r of k.children) { if (r.localName === 'table-row') { const tr = mk('tr', tb); for (const cc of r.children) if (cc.localName === 'table-cell') { const td = mk('td', tr); const cs = A(cc, 'number-columns-spanned'), rs = A(cc, 'number-rows-spanned'); if (cs > 1) td.setAttribute('colspan', cs); if (rs > 1) td.setAttribute('rowspan', rs); blockKids(cc, td); } } else if (/^table-(header-rows|rows|row-group)$/.test(r.localName)) rows(r); } }; rows(c); }
      else if (/^(tracked-changes|sequence-decls|forms|variable-decls|user-field-decls)$/.test(n)) continue;
      else blockKids(c, into); // sections, indexes and the like: what is inside them
    }
  }
  const text = [...x.getElementsByTagName('*')].find(e => e.localName === 'text' && e.parentNode?.localName === 'body');
  if (!text) throw new Refused('This OpenDocument file is not a text document (it may be a spreadsheet or a presentation), so there is nothing here to read.');
  blockKids(text, body);
  const image = await pictures(tmp, zip, s => s.replace(/^\.\//, ''), blobs);
  const frag = sanitize(body, out, { count, image });
  let meta = null; try { meta = zip.has('meta.xml') ? await zip.text('meta.xml') : null; } catch (e) {}
  const title = meta ? (/<dc:title>([^<]*)<\/dc:title>/.exec(meta)?.[1] || '').trim() : '';
  return { frag, title, notes: ['OpenDocument files are shown for reading: the words, headings, lists, tables, pictures and links are here. Page layout, fonts, colours, headers and footers and tracked changes are not, so it will not look as it does in LibreOffice.'] };
}

/* ---------- ebooks (.epub): the book's chapters in reading order, one long scroll ---------- */
const xmlOf = s => new DOMParser().parseFromString(s, 'application/xml');
function join(base, rel) { // a path inside the book, from the file that mentions it
  let r = rel.split('#')[0].split('?')[0]; try { r = decodeURIComponent(r); } catch (e) {}
  const parts = r.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const p of r.split('/')) { if (p === '..') parts.pop(); else if (p && p !== '.') parts.push(p); }
  return parts.join('/');
}
async function readEpub(buffer, out, count, blobs) {
  const zip = await openZip(buffer);
  const cont = zip.has('META-INF/container.xml') ? xmlOf(await zip.text('META-INF/container.xml')) : null;
  const opfPath = cont && [...cont.getElementsByTagName('*')].find(e => e.localName === 'rootfile')?.getAttribute('full-path');
  if (!opfPath || !zip.has(opfPath)) throw new Refused('This file is not an ebook inside (its contents list is missing). It may be damaged or only partly downloaded.');
  if (zip.has('META-INF/encryption.xml')) { const e = await zip.text('META-INF/encryption.xml'); if (/EncryptedData/.test(e) && !/idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/.test(e)) throw new Refused('This ebook is locked by its shop (copy protection, "DRM"), so its pages are scrambled and cannot be read here. Read it in the shop\'s own app.'); }
  const opf = xmlOf(await zip.text(opfPath)), all = [...opf.getElementsByTagName('*')], first = n => all.find(e => e.localName === n);
  const title = (first('title')?.textContent || '').trim(), author = (first('creator')?.textContent || '').trim();
  const items = new Map(); for (const it of all) if (it.localName === 'item') items.set(it.getAttribute('id'), { path: join(opfPath, it.getAttribute('href') || ''), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  const spine = all.filter(e => e.localName === 'itemref').map(r => items.get(r.getAttribute('idref'))).filter(it => it && zip.has(it.path) && /x?html|xml/.test(it.type));
  if (!spine.length) throw new Refused('This ebook has no chapters that can be read here.');
  const where = new Map(spine.map((it, k) => [it.path, k]));
  const frag = out.createDocumentFragment();
  for (let k = 0; k < spine.length; k++) {
    const it = spine[k], d = inert(await zip.text(it.path), true), root = d.body || d.getElementsByTagName('body')[0] || d.documentElement;
    // pictures: <img src> and the <image> inside a drawing (covers) both become plain pictures first
    const tmp = document.implementation.createHTMLDocument('');
    for (const im of [...root.querySelectorAll('img, image')]) { const s = im.getAttribute('src') ?? im.getAttribute('xlink:href') ?? im.getAttribute('href') ?? ''; if (s && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(s)) { const g = tmp.createElement('img'); g.setAttribute('src', s); tmp.body.appendChild(g); } }
    for (const l of root.ownerDocument.querySelectorAll('link[href]')) if (/^\s*(https?:|\/\/)/i.test(l.getAttribute('href'))) count.remoteOther++;
    const image = await pictures(tmp, zip, s => join(it.path, s), blobs);
    const ch = el(out, 'div', 'chapter'); ch.id = 'ch' + k;
    ch.appendChild(sanitize(root, out, { count, image, idPrefix: `c${k}-`, link: h => { const p = join(it.path, h), f = h.split('#')[1]; return where.has(p) ? (f ? `#c${where.get(p)}-${f}` : `#ch${where.get(p)}`) : null; } }));
    frag.appendChild(ch);
  }
  // the contents list the book ships with (EPUB 3 nav, else EPUB 2 ncx)
  const outline = [], target = (base, src) => { const p = join(base, src), f = src.split('#')[1]; return where.has(p) ? (f ? `c${where.get(p)}-${f}` : `ch${where.get(p)}`) : null; };
  try {
    const nav = [...items.values()].find(i => /\bnav\b/.test(i.props)), ncx = [...items.values()].find(i => i.type === 'application/x-dtbncx+xml');
    if (nav && zip.has(nav.path)) {
      const d = inert(await zip.text(nav.path), true), toc = [...d.querySelectorAll('nav')].find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || d.querySelector('nav');
      const go = (ol, level) => { for (const li of ol.children) { const a = [...li.children].find(c => c.localName === 'a'), sub = [...li.children].find(c => c.localName === 'ol'); if (a) { const id = target(nav.path, a.getAttribute('href') || ''); if (id) outline.push({ level, text: a.textContent.trim().replace(/\s+/g, ' '), id }); } if (sub && level < 4) go(sub, level + 1); } };
      const ol = toc && [...toc.children].find(c => c.localName === 'ol'); if (ol) go(ol, 1);
    } else if (ncx && zip.has(ncx.path)) {
      const d = xmlOf(await zip.text(ncx.path));
      const go = (node, level) => { for (const np of node.children) if (np.localName === 'navPoint') { const label = [...np.children].find(c => c.localName === 'navLabel')?.textContent.trim().replace(/\s+/g, ' '), src = [...np.children].find(c => c.localName === 'content')?.getAttribute('src'); const id = src && target(ncx.path, src); if (id && label) outline.push({ level, text: label, id }); if (level < 4) go(np, level + 1); } };
      const map = [...d.getElementsByTagName('*')].find(e => e.localName === 'navMap'); if (map) go(map, 1);
    }
  } catch (e) {}
  return { frag, title: author && title ? `${title} · ${author}` : title, outline: outline.length ? outline : null, notes: ['Ebooks are shown as one long page in the Reader\'s own type. The book\'s own fonts, colours and page design are not used.'] };
}

/* ---------- the one way in ---------- */
export async function convert(file, out) {
  const kind = extOf(file.name), count = newCount(), blobs = [];
  if (!(kind in KINDS)) throw new Refused(`The Reader does not open “.${kind}” files yet.`);
  if (file.size > 400 * 1024 * 1024) throw new Refused('This file is over 400 MB, which is more than the Reader will take in for a document like this.');
  const buffer = await file.arrayBuffer(); let r;
  try {
    if (['docx', 'odt', 'epub'].includes(kind) && new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength)).join() === '123,92,114,116,102') r = readRtf(new Uint8Array(buffer), out); // Word often saves Rich Text under a .doc/.docx name
    else if (kind === 'docx') r = await readDocx(buffer, out, count);
    else if (kind === 'odt') r = await readOdt(buffer, out, count, blobs);
    else if (kind === 'epub') r = await readEpub(buffer, out, count, blobs);
    else if (kind === 'rtf') r = readRtf(new Uint8Array(buffer), out);
    else {
      if (buffer.byteLength > MAX_TEXT) throw new Refused('This text file is over 60 MB: too much to lay out as one page.');
      const text = decodeText(new Uint8Array(buffer));
      if (/\u0000/.test(text.slice(0, 4000))) throw new Refused('This file is not text inside (it looks like a program or a picture with a text ending), so it was not opened.');
      r = KINDS[kind] === 'Markdown' ? await readMd(text, out, count) : KINDS[kind] === 'Screenplay' ? readFountain(text, out) : readTxt(text, out);
    }
  } catch (e) { for (const u of blobs) URL.revokeObjectURL(u); throw e; }
  return { kind, label: KINDS[kind], title: r.title || '', frag: r.frag, count, notes: r.notes || [], outline: r.outline || null, blobs };
}
