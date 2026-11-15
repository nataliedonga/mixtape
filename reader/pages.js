/* Page tools for PDFs: rotate, delete, reorder (drag, or Alt+arrows), add the pages of other PDFs (merge), extract
   pages to a new PDF, split into several files.
   HOW IT KEEPS THE READER'S PROMISES. Rotate, delete, reorder and add are laid out here first and nothing changes
   until "Apply". Apply makes the new bytes of the SAME document and hands them to the app (hooks.replace), which
   puts them in the same tab and through the same saving as any other change: saved as you go, a file changed
   elsewhere is not overwritten, Back to original still restores the file as first opened, and the bytes from just
   before are kept so the change can be undone. Extract and Split never touch the document: they always write NEW
   files.
   DELETED MEANS GONE. The work is done with pdf-lib (MIT, ../vendor/pdf-lib). The document is edited in place so
   its form, bookmarks, notes and information survive; the pages are re-listed in their new order; a deleted page is
   emptied and then every object nothing refers to any more is dropped before saving, so the words and pictures of
   a deleted page are not left behind in the file.
   Thumbnails come from the viewer's own engine (PDFium). */

const $ = s => document.querySelector(s);
const LIB = new URL('../vendor/pdf-lib/pdf-lib.esm.min.js', import.meta.url).href;
let L = null; export const lib = async () => L || (L = await import(LIB));
let hooks = {}, S = null; // S: the session while the panel is open

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const wait = t => (t && typeof t.toPromise === 'function' ? t.toPromise() : new Promise((res, rej) => t.wait(res, e => rej(e && (e.reason || e)))));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
function ranges(nums) { // [1,2,3,5] -> "1-3, 5"
  const out = []; let a = null, b = null;
  for (const n of nums) { if (a == null) a = b = n; else if (n === b + 1) b = n; else { out.push(a === b ? `${a}` : `${a}-${b}`); a = b = n; } }
  if (a != null) out.push(a === b ? `${a}` : `${a}-${b}`);
  return out.join(', ');
}
export async function load(bytes) {
  const P = await lib();
  try { return await P.PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { if (/encrypt/i.test(e?.message || '')) { const x = new Error('This PDF is protected with a password or with permissions, and page tools cannot change a protected PDF. Open it in the program that protected it, save it without protection, and try again.'); x.plain = true; throw x; } throw e; }
}

/* ---------- making the new document ---------- */
export function sweep(P, ctx) { // drop every object nothing refers to any more (what a deleted page leaves behind)
  const key = r => `${r.objectNumber} ${r.generationNumber}`, live = new Set(), todo = Object.values(ctx.trailerInfo).filter(Boolean);
  while (todo.length) {
    const o = todo.pop();
    if (o instanceof P.PDFRef) { if (live.has(key(o))) continue; live.add(key(o)); const v = ctx.lookup(o); if (v) todo.push(v); }
    else if (o instanceof P.PDFDict) for (const [, v] of o.entries()) todo.push(v);
    else if (o instanceof P.PDFArray) for (const v of o.asArray()) todo.push(v);
    else if (o instanceof P.PDFStream) todo.push(o.dict);
  }
  let n = 0; for (const [ref] of ctx.enumerateIndirectObjects()) if (!live.has(key(ref))) { ctx.delete(ref); n++; }
  return n;
}
/* Bookmarks and named places that pointed at a deleted page go with it (a bookmark's title can give away what the
   page said). A bookmark that has others under it is kept as a plain label, without its jump. */
function unbookmark(P, doc, dead) {
  const ctx = doc.context, N = P.PDFName.of, key = r => `${r.objectNumber} ${r.generationNumber}`, val = v => (v instanceof P.PDFRef ? ctx.lookup(v) : v);
  const text = v => { try { return v.decodeText(); } catch (e) { return null; } };
  const pageOf = v => { v = val(v); if (v instanceof P.PDFDict) v = val(v.get(N('D'))); if (v instanceof P.PDFArray && v.size()) { const p = v.get(0); return p instanceof P.PDFRef ? key(p) : null; } return null; };
  const named = new Map(); // name -> the page it points at
  const old = val(doc.catalog.get(N('Dests')));
  if (old instanceof P.PDFDict) for (const [k, v] of old.entries()) { const pg = pageOf(v); named.set(text(k), pg); if (dead.has(pg)) old.delete(k); }
  const tree = (node, depth) => {
    node = val(node); if (!(node instanceof P.PDFDict) || depth > 40) return;
    const pairs = val(node.get(N('Names')));
    if (pairs instanceof P.PDFArray) for (let i = pairs.size() - 2; i >= 0; i -= 2) { const pg = pageOf(pairs.get(i + 1)); named.set(text(val(pairs.get(i))), pg); if (dead.has(pg)) { pairs.remove(i + 1); pairs.remove(i); } }
    const kids = val(node.get(N('Kids'))); if (kids instanceof P.PDFArray) for (const k of kids.asArray()) tree(k, depth + 1);
  };
  const names = val(doc.catalog.get(N('Names'))); if (names instanceof P.PDFDict) tree(names.get(N('Dests')), 0);
  const target = item => {
    let d = val(item.get(N('Dest'))); const a = val(item.get(N('A')));
    if (!d && a instanceof P.PDFDict) d = val(a.get(N('D')));
    if (d instanceof P.PDFArray || d instanceof P.PDFDict) return pageOf(d);
    return d ? named.get(text(d)) ?? null : null;
  };
  const prune = (parent, depth) => {
    const kids = []; let ref = parent.get(N('First')), guard = 0;
    while (ref instanceof P.PDFRef && guard++ < 20000) { const it = ctx.lookup(ref); if (!(it instanceof P.PDFDict)) break; kids.push([ref, it]); ref = it.get(N('Next')); }
    const keep = [];
    for (const [r, it] of kids) {
      if (depth < 40) prune(it, depth + 1);
      if (dead.has(target(it))) { if (!it.get(N('First'))) continue; it.delete(N('Dest')); it.delete(N('A')); }
      keep.push([r, it]);
    }
    if (keep.length === kids.length) return;
    keep.forEach(([r, it], i) => { if (i) it.set(N('Prev'), keep[i - 1][0]); else it.delete(N('Prev')); if (i < keep.length - 1) it.set(N('Next'), keep[i + 1][0]); else it.delete(N('Next')); });
    parent.delete(N('Count'));
    if (keep.length) { parent.set(N('First'), keep[0][0]); parent.set(N('Last'), keep[keep.length - 1][0]); } else { parent.delete(N('First')); parent.delete(N('Last')); }
  };
  const root = val(doc.catalog.get(N('Outlines'))); if (root instanceof P.PDFDict) { prune(root, 0); if (!root.get(N('First'))) doc.catalog.delete(N('Outlines')); }
}
const INHERIT = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];
/* items: [{ src, page, rot }] in the order wanted; src 0 is the document itself, others index into `added`. */
export async function rebuild(bytes, items, added = []) {
  const P = await lib(), doc = await load(bytes), ctx = doc.context, pages = doc.getPages();
  const rootRef = doc.catalog.get(P.PDFName.of('Pages')), root = doc.catalog.Pages(), from = [null];
  for (let a = 0; a < added.length; a++) {
    const want = [...new Set(items.filter(i => i.src === a + 1).map(i => i.page))];
    if (!want.length) { from.push(new Map()); continue; }
    const other = await load(added[a].bytes), got = await doc.copyPages(other, want);
    from.push(new Map(want.map((p, k) => [p, got[k]])));
  }
  const kept = new Set(), refs = [];
  for (const it of items) {
    const pg = it.src === 0 ? pages[it.page] : from[it.src].get(it.page);
    for (const k of INHERIT) { const name = P.PDFName.of(k); if (!pg.node.get(name)) { const v = pg.node.getInheritableAttribute(name); if (v) pg.node.set(name, v); } }
    if (it.rot) pg.setRotation(P.degrees((((pg.getRotation().angle + it.rot) % 360) + 360) % 360));
    refs.push(pg.ref); if (it.src === 0) kept.add(it.page);
  }
  for (const it of items) (it.src === 0 ? pages[it.page] : from[it.src].get(it.page)).node.setParent(rootRef);
  const dead = new Set(); pages.forEach((pg, i) => { if (!kept.has(i)) dead.add(`${pg.ref.objectNumber} ${pg.ref.generationNumber}`); });
  if (dead.size) unbookmark(P, doc, dead);
  pages.forEach((pg, i) => { if (!kept.has(i)) for (const k of [...pg.node.keys()]) if (k !== P.PDFName.of('Type')) pg.node.delete(k); }); // a deleted page is emptied, so a bookmark that still points at it holds nothing
  root.set(P.PDFName.of('Kids'), ctx.obj(refs)); root.set(P.PDFName.of('Count'), P.PDFNumber.of(refs.length));
  sweep(P, ctx);
  return doc.save({ updateFieldAppearances: false });
}
/* a NEW document holding only these pages (extract, split) */
export async function extract(bytes, items, added = []) {
  const P = await lib(), out = await P.PDFDocument.create(), srcs = [await load(bytes)];
  for (const a of added) srcs.push(items.some(i => i.src === srcs.length) ? await load(a.bytes) : null);
  for (const it of items) { const [pg] = await out.copyPages(srcs[it.src], [it.page]); if (it.rot) pg.setRotation(P.degrees((((pg.getRotation().angle + it.rot) % 360) + 360) % 360)); out.addPage(pg); }
  return out.save();
}

/* ---------- the panel ---------- */
const snap = () => S.items.map(i => ({ ...i }));
function push() { S.past.push(snap()); if (S.past.length > 60) S.past.shift(); }
const changedNow = () => S.items.length !== S.count0 || S.items.some((it, k) => it.src !== 0 || it.page !== k || it.rot);
function draw(focusKey) {
  const g = $('#pgGrid'), sel = S.items.filter(i => i.sel).length;
  g.innerHTML = S.items.map((it, k) => `<div class="pg${it.sel ? ' sel' : ''}" role="option" aria-selected="${!!it.sel}" tabindex="${k === S.at ? 0 : -1}" data-k="${k}" aria-label="Page ${k + 1}${it.src ? ', from ' + esc(S.added[it.src - 1].name) : it.page !== k ? ', was page ' + (it.page + 1) : ''}${it.rot ? ', turned' : ''}${it.sel ? ', selected' : ''}">
    <span class="th"><img alt="" draggable="false" src="${esc(S.thumbs.get(it.src + ':' + it.page) || '')}" style="transform:rotate(${it.rot}deg)"></span>
    <span class="no"><b>${k + 1}</b>${it.src ? `<small>${esc(S.added[it.src - 1].name)} p.${it.page + 1}</small>` : it.page !== k ? `<small>was ${it.page + 1}</small>` : ''}</span></div>`).join('');
  const ch = changedNow();
  $('#pgInfo').textContent = `${plural(S.items.length, 'page', 'pages')}${sel ? ` · ${sel} selected` : ' · click a page to select it (Ctrl or Shift for several)'}${ch ? ' · not applied yet' : ''}`;
  for (const id of ['pgLeft', 'pgRight', 'pgDel', 'pgExtract', 'pgBack', 'pgFwd']) $('#' + id).disabled = !sel;
  $('#pgDel').disabled = !sel || sel === S.items.length;
  $('#pgUndo').disabled = !S.past.length; $('#pgApply').disabled = !ch || S.busy;
  $('#pgUndoApplied').hidden = !hooks.canUndo?.(S.id);
  if (focusKey != null) g.querySelector(`[data-k="${focusKey}"]`)?.focus();
}
async function thumbsFor(src, engDoc) {
  for (const pg of engDoc.pages) {
    if (!S || S.closed) return;
    const key = src + ':' + pg.index; if (S.thumbs.has(key)) continue;
    try { const blob = await wait(hooks.engine().renderPage(engDoc, pg, { scaleFactor: Math.min(0.5, 220 / Math.max(pg.size.width, pg.size.height)), rotation: pg.rotation, withAnnotations: true })); const u = URL.createObjectURL(blob); S.thumbs.set(key, u); S.urls.push(u); } catch (e) { continue; }
    for (const im of document.querySelectorAll('#pgGrid .pg')) { const it = S.items[+im.dataset.k]; if (it && it.src + ':' + it.page === key) im.querySelector('img').src = S.thumbs.get(key); }
  }
}
export async function openPages(id) {
  if (S) return;
  const name = hooks.nameOf(id), engDoc = hooks.docOf(id);
  if (!engDoc) return hooks.toast('Open a PDF first: page tools work on the PDF in front.');
  S = { id, name, bytes: null, items: engDoc.pages.map((p, k) => ({ src: 0, page: k, rot: 0, sel: false })), count0: engDoc.pages.length, added: [], past: [], thumbs: new Map(), urls: [], at: 0, anchor: 0, busy: false, closed: false };
  $('#pgTitle').textContent = `Pages of “${name}”`; $('#pages').hidden = false; draw(0);
  thumbsFor(0, engDoc);
  try { S.bytes = new Uint8Array(await (await hooks.bytesOf(id)).arrayBuffer()); await load(S.bytes); }
  catch (e) { const m = e?.plain ? e.message : `Page tools could not read this PDF: ${e?.message || e}`; closePages(); hooks.toast(m, 12000); }
}
export function closePages() {
  if (!S) return; S.closed = true;
  for (const u of S.urls) URL.revokeObjectURL(u);
  for (const a of S.added) { try { hooks.engine().closeDocument(a.eng); } catch (e) {} }
  S = null; $('#pages').hidden = true; $('#pgGrid').textContent = '';
}
const selected = () => S.items.filter(i => i.sel);
function rotate(by) { if (!selected().length) return; push(); for (const it of S.items) if (it.sel) it.rot = (((it.rot + by) % 360) + 360) % 360; draw(S.at); }
function remove() {
  const n = selected().length; if (!n) return;
  if (n === S.items.length) return hooks.toast('A PDF needs at least one page: leave one unselected.');
  push(); S.items = S.items.filter(i => !i.sel); S.at = Math.min(S.at, S.items.length - 1); draw(S.at);
}
function moveTo(index) { // put the selected pages, in their order, in front of what is now at `index`
  const sel = selected(); if (!sel.length) return;
  const before = S.items.slice(0, index).filter(i => !i.sel).length, rest = S.items.filter(i => !i.sel);
  const next = [...rest.slice(0, before), ...sel, ...rest.slice(before)];
  if (next.every((it, k) => it === S.items[k])) return;
  push(); S.items = next; S.at = S.items.indexOf(sel[0]); draw(S.at);
}
function nudge(by) { const sel = selected(); if (!sel.length) return; const first = S.items.indexOf(sel[0]), last = S.items.indexOf(sel[sel.length - 1]); moveTo(by < 0 ? Math.max(0, first - 1) : Math.min(S.items.length, last + 2)); }
function undo() { if (!S.past.length) return; S.items = S.past.pop(); S.at = Math.min(S.at, S.items.length - 1); draw(S.at); }
function pick(k, e) {
  if (e && e.shiftKey) { const [a, b] = [Math.min(S.anchor, k), Math.max(S.anchor, k)]; S.items.forEach((it, i) => { it.sel = i >= a && i <= b; }); }
  else if (e && (e.ctrlKey || e.metaKey)) { S.items[k].sel = !S.items[k].sel; S.anchor = k; }
  else { const only = S.items[k].sel && selected().length === 1; S.items.forEach((it, i) => { it.sel = i === k && !only; }); S.anchor = k; }
  S.at = k; draw(k);
}
async function addFiles(files) {
  for (const f of files) {
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { hooks.toast(`“${f.name}” is not a PDF, so its pages cannot be added.`, 6000); continue; }
    try {
      const bytes = new Uint8Array(await f.arrayBuffer()); await load(bytes);
      const eng = await wait(hooks.engine().openDocumentBuffer({ id: 'pages-add-' + Date.now() + '-' + S.added.length, content: bytes.slice().buffer }));
      push(); S.added.push({ name: f.name, bytes, eng }); const src = S.added.length;
      S.items.forEach(i => { i.sel = false; }); for (const p of eng.pages) S.items.push({ src, page: p.index, rot: 0, sel: true });
      draw(); $('#pgGrid').lastElementChild?.scrollIntoView({ block: 'nearest' }); thumbsFor(src, eng);
      hooks.toast(`${plural(eng.pages.length, 'page', 'pages')} from “${f.name}” added at the end (selected, so you can drag them where they belong). Fillable form fields in added pages become plain.`, 8000);
    } catch (e) { hooks.toast(e?.plain ? `“${f.name}”: ${e.message}` : `“${f.name}” could not be added: ${e?.message || e}`, 9000); }
  }
}
let isOpen = async () => false; // set by the app: is this file open in the Reader?
export async function saveNew(bytes, suggested) { // always a NEW file; returns its name, or null if the dialog was closed
  const blob = new Blob([bytes], { type: 'application/pdf' });
  if (window.showSaveFilePicker) {
    let h; try { h = await showSaveFilePicker({ suggestedName: suggested, id: 'reader-save', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); } catch (e) { if (e.name === 'AbortError') return null; throw e; }
    if (await isOpen(h)) throw new Error('that file is open in the Reader. Choose another name: page tools never write over an open document.');
    const w = await h.createWritable(); await w.write(blob); await w.close(); return { name: h.name, handle: h };
  }
  const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = suggested; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60e3);
  return { name: suggested + ' (in your Downloads)', handle: null };
}
const base = () => S.name.replace(/\.pdf$/i, '');
async function doExtract() {
  const sel = selected(); if (!sel.length || S.busy) return;
  S.busy = true;
  try {
    const nums = sel.map(i => S.items.indexOf(i) + 1), bytes = await extract(S.bytes, sel, S.added);
    const got = await saveNew(bytes, `${base()} (pages ${ranges(nums)}).pdf`);
    if (got) hooks.toast(`Saved ${plural(sel.length, 'page', 'pages')} as “${got.name}”. “${S.name}” itself is unchanged.`, 9000, got.handle ? [['Open it', async () => hooks.openFile(await got.handle.getFile(), got.handle)]] : []);
  } catch (e) { hooks.toast(`Could not save those pages: ${e?.message || e}`, 9000); }
  finally { if (S) { S.busy = false; draw(); } }
}
function parseSplit() { // -> [[start,end], …] in page numbers (1-based) of what the panel shows, or a sentence saying what is wrong
  const n = S.items.length, mode = $('#pgSplitMode').value, v = $('#pgSplitVal').value.trim();
  if (mode === 'each') return Array.from({ length: n }, (_, k) => [k + 1, k + 1]);
  if (mode === 'every') { const m = parseInt(v, 10); if (!(m >= 1)) return 'Type how many pages each file should have, for example 2.'; const out = []; for (let a = 1; a <= n; a += m) out.push([a, Math.min(n, a + m - 1)]); return out; }
  const out = [];
  for (const part of v.split(/[,;]+/).map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part); if (!m) return `“${part}” is not a page or a range of pages. Write them like 1-3, 4, 5-9.`;
    const a = +m[1], b = +(m[2] || m[1]); if (a < 1 || b > n || a > b) return `“${part}” does not fit: this document has pages 1 to ${n}.`;
    out.push([a, b]);
  }
  return out.length ? out : 'Type the pages for each file, for example 1-3, 4-6.';
}
function drawSplit() {
  const mode = $('#pgSplitMode').value, r = parseSplit();
  $('#pgSplitVal').hidden = mode === 'each'; $('#pgSplitVal').placeholder = mode === 'every' ? 'pages per file, e.g. 2' : 'e.g. 1-3, 4-6';
  $('#pgSplitSay').textContent = typeof r === 'string' ? r : `Makes ${plural(r.length, 'new file', 'new files')}: ${r.slice(0, 6).map(([a, b]) => a === b ? `page ${a}` : `pages ${a}-${b}`).join('; ')}${r.length > 6 ? '; …' : ''}. “${S.name}” itself is unchanged.`;
  $('#pgSplitGo').disabled = typeof r === 'string';
}
async function doSplit() {
  const r = parseSplit(); if (typeof r === 'string' || S.busy) return;
  S.busy = true; $('#pgSplitGo').disabled = true;
  try {
    let dir = null;
    if (window.showDirectoryPicker) { try { dir = await showDirectoryPicker({ mode: 'readwrite', id: 'reader-split' }); } catch (e) { if (e.name === 'AbortError') return; throw e; } }
    const made = [];
    for (const [a, b] of r) {
      const bytes = await extract(S.bytes, S.items.slice(a - 1, b), S.added), stem = `${base()} (${a === b ? 'page ' + a : 'pages ' + a + '-' + b})`;
      if (dir) {
        let name = stem + '.pdf', k = 1;
        for (;;) { try { await dir.getFileHandle(name); name = `${stem} (${++k}).pdf`; } catch (e) { break; } } // never write over a file that is already there
        const h = await dir.getFileHandle(name, { create: true }), w = await h.createWritable(); await w.write(new Blob([bytes], { type: 'application/pdf' })); await w.close(); made.push(name);
      } else { const x = document.createElement('a'), u = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); x.href = u; x.download = stem + '.pdf'; x.click(); setTimeout(() => URL.revokeObjectURL(u), 60e3); made.push(stem + '.pdf'); await new Promise(res => setTimeout(res, 250)); }
    }
    $('#pgSplit').hidden = true;
    hooks.toast(`Made ${plural(made.length, 'new file', 'new files')}${dir ? ` in “${dir.name}”` : ' in your Downloads'}: ${made.slice(0, 3).join(', ')}${made.length > 3 ? ', …' : ''}. “${S.name}” itself is unchanged.`, 10000);
  } catch (e) { hooks.toast(`Could not split: ${e?.message || e}`, 9000); }
  finally { if (S) { S.busy = false; drawSplit(); } }
}
async function apply() {
  if (!S || S.busy || !changedNow()) return;
  S.busy = true; draw();
  try {
    const own = S.items.filter(i => i.src === 0), moved = own.some((it, k) => it.rot || (k && it.page < own[k - 1].page)) || S.items.some((it, k) => it.src && S.items.slice(k).some(x => !x.src));
    const n0 = S.count0, bytes = await rebuild(S.bytes, S.items, S.added), kept = S.items.filter(i => i.src === 0).length, gone = n0 - kept, came = S.items.length - kept, name = S.name, id = S.id;
    closePages();
    const nid = await hooks.replace(id, new Blob([bytes], { type: 'application/pdf' }));
    const what = [gone ? `${plural(gone, 'page', 'pages')} deleted (removed from the file, not hidden)` : '', came ? `${plural(came, 'page', 'pages')} added` : '', moved ? (gone || came ? 'the rest rearranged or turned' : 'pages rearranged or turned') : ''].filter(Boolean).join(', ');
    hooks.toast(`“${name}”: ${what}.`, 30000, [['Undo', () => hooks.undo(nid)]]);
  } catch (e) { if (S) { S.busy = false; draw(); } hooks.toast(e?.plain ? e.message : `The pages could not be changed: ${e?.message || e}`, 10000); }
}

export function initPages(h) {
  hooks = h; if (h.isOpenFile) isOpen = h.isOpenFile;
  const g = $('#pgGrid');
  $('#pgLeft').addEventListener('click', () => rotate(-90)); $('#pgRight').addEventListener('click', () => rotate(90));
  $('#pgDel').addEventListener('click', remove); $('#pgUndo').addEventListener('click', undo);
  $('#pgBack').addEventListener('click', () => nudge(-1)); $('#pgFwd').addEventListener('click', () => nudge(1));
  $('#pgExtract').addEventListener('click', doExtract);
  $('#pgAdd').addEventListener('click', async () => {
    if (!window.showOpenFilePicker) return $('#pgFile').click();
    let hs; try { hs = await showOpenFilePicker({ multiple: true, id: 'reader-open', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); } catch (e) { return; }
    addFiles(await Promise.all(hs.map(x => x.getFile())));
  });
  $('#pgFile').addEventListener('change', e => { addFiles([...e.target.files]); e.target.value = ''; });
  $('#pgSplitBtn').addEventListener('click', () => { $('#pgSplit').hidden = !$('#pgSplit').hidden; if (!$('#pgSplit').hidden) { drawSplit(); $('#pgSplitMode').focus(); } });
  $('#pgSplitMode').addEventListener('change', drawSplit); $('#pgSplitVal').addEventListener('input', drawSplit);
  $('#pgSplitGo').addEventListener('click', doSplit);
  $('#pgCancel').addEventListener('click', () => { if (changedNow() && !confirm('Close page tools without applying the changes you laid out?')) return; closePages(); });
  $('#pgApply').addEventListener('click', apply);
  $('#pgUndoApplied').addEventListener('click', () => { const id = S.id; closePages(); hooks.undo(id); });
  g.addEventListener('keydown', e => {
    const it = e.target.closest('.pg'); if (!it || !S) return; const k = +it.dataset.k, ctrl = e.ctrlKey || e.metaKey;
    const cols = Math.max(1, Math.round(g.clientWidth / (it.offsetWidth + 14)));
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
    if (step && e.altKey) { e.preventDefault(); if (!S.items[k].sel) pick(k); nudge(step < 0 ? -1 : 1); }
    else if (step) { e.preventDefault(); const to = Math.max(0, Math.min(S.items.length - 1, k + step)); if (e.shiftKey) pick(to, { shiftKey: true }); else { S.at = to; draw(to); } }
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); pick(k, { ctrlKey: true }); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); if (!selected().length) pick(k); remove(); }
    else if (ctrl && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); S.items.forEach(i => { i.sel = true; }); draw(k); }
    else if (ctrl && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); if (!selected().length) pick(k); rotate(e.shiftKey ? -90 : 90); }
  });
  // click to select; press and drag to move (pointer events, so it works with a mouse, a pen or a finger)
  let drag = null;
  g.addEventListener('pointerdown', e => { const it = e.target.closest('.pg'); if (!it || e.button) return; drag = { k: +it.dataset.k, x: e.clientX, y: e.clientY, on: false, e: { shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey }, to: null }; });
  addEventListener('pointermove', e => {
    if (!drag || !S) return;
    if (!drag.on) { if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return; drag.on = true; if (!S.items[drag.k].sel) { S.items.forEach((i, n) => { i.sel = n === drag.k; }); S.at = drag.k; draw(); } g.classList.add('dragging'); }
    e.preventDefault();
    let best = null, bd = 1e9; const box = $('#pages').getBoundingClientRect(); // the gap nearest the pointer
    for (const el of g.querySelectorAll('.pg')) { const r = el.getBoundingClientRect(); if (e.clientY < r.top - 10 || e.clientY > r.bottom + 10) continue; for (const [x, idx] of [[r.left, +el.dataset.k], [r.right, +el.dataset.k + 1]]) { const d = Math.abs(e.clientX - x); if (d < bd) { bd = d; best = { idx, x: x - box.left + (idx === +el.dataset.k ? -8 : 6), y: r.top - box.top, h: r.height }; } } }
    const m = $('#pgMark'); drag.to = best ? best.idx : null; m.hidden = !best;
    if (best) { m.style.left = best.x + 'px'; m.style.top = best.y + 'px'; m.style.height = best.h + 'px'; }
    const gr = g.getBoundingClientRect(); if (e.clientY < gr.top + 40) g.scrollTop -= 14; else if (e.clientY > gr.bottom - 40) g.scrollTop += 14;
  });
  addEventListener('pointerup', () => {
    if (!drag || !S) { drag = null; return; }
    const d = drag; drag = null; g.classList.remove('dragging'); $('#pgMark').hidden = true;
    if (d.on) { if (d.to != null) moveTo(d.to); } else pick(d.k, d.e);
  });
  addEventListener('pointercancel', () => { drag = null; g.classList.remove('dragging'); $('#pgMark').hidden = true; });
  addEventListener('keydown', e => { if (S && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); if ($('#pgSplit').hidden) $('#pgCancel').click(); else $('#pgSplit').hidden = true; } });
}
export const pagesOpen = () => !!S;
