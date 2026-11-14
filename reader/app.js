/* Reader: open a PDF, read it, mark it up (highlight, underline, strike out, notes, drawing, shapes, stamps), fill its
   forms, sign it. Every change is saved into the same file as you make it; Undo (Ctrl+Z) takes a change back and that
   is saved too; "Back to original" puts the file back exactly as it was when it was opened here.
   The viewer is EmbedPDF (MIT; Google's PDFium compiled to WebAssembly), in ../vendor/embedpdf with its licence; every
   outside download it would make by default (its engine, fonts, stamp sets, Google webfonts) is pointed at the copies
   here or switched off, and the page's Content-Security-Policy makes the browser refuse any other connection, so
   nothing is fetched while a document is open and nothing is ever uploaded.
   Redaction is switched off until it has its own check that the blacked-out words are really gone from the saved
   file (a box drawn over words leaves them in the file; that has leaked court papers). */

/* Links inside a PDF: the viewer opens them with window.open. A document should not be able to send you to a web page
   without your say-so, or hand that page a way back into this tab, so every such opening comes through here first. */
const realOpen = window.open.bind(window);
window.open = url => {
  let u; try { u = new URL(String(url), location.href); } catch (e) { return null; }
  if (!/^(https?|mailto):$/.test(u.protocol)) { toast('A link in this document was not opened (it is not a web or email address).', 5000); return null; }
  if (!confirm(`This document has a link to:\n\n${u.href.slice(0, 300)}\n\nOpen it in a new tab? (The web page will be told nothing about this document.)`)) return null;
  realOpen(u.href, '_blank', 'noopener,noreferrer'); return null;
};

import EmbedPDF from '../vendor/embedpdf/embedpdf.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let toastT = 0;
function toast(m, ms = 3500, actions = []) { // actions: [[label, fn], …] shown as buttons in the toast
  const t = $('#toast'); t.textContent = m; t.hidden = false;
  for (const [label, fn] of actions) { const b = document.createElement('button'); b.textContent = label; b.addEventListener('click', () => { t.hidden = true; fn(); }); t.appendChild(b); }
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
}
const V = new URL('../vendor/embedpdf/', import.meta.url).href;
// a task from the viewer (it has its own promise-like type) as a promise
const done = t => (t && typeof t.toPromise === 'function' ? t.toPromise() : new Promise((res, rej) => t.wait(res, e => rej(e && (e.reason || e)))));
const LS = { get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

/* ---------- the viewer ---------- */
const noto = [{ url: V + 'fonts/NotoSans-Regular.ttf', weight: 400 }, { url: V + 'fonts/NotoSans-Bold.ttf', weight: 700 }, { url: V + 'fonts/NotoSans-Italic.ttf', weight: 400, italic: true }, { url: V + 'fonts/NotoSans-BoldItalic.ttf', weight: 700, italic: true }];
const viewerEl = EmbedPDF.init({
  type: 'container', target: $('#viewer'),
  wasmUrl: V + 'pdfium.wasm', worker: true,
  fontFallback: { fonts: { 204: noto, 161: noto, 163: noto } }, // Cyrillic, Greek, Vietnamese; plain Latin needs none
  fonts: { ui: null, signature: null },                      // no Google Fonts: the system's fonts (typed signatures use its handwriting fonts)
  stamp: { manifests: [] },                                   // no stamp sets from the internet; make your own from a picture
  disabledCategories: ['redaction'],
  tabBar: 'multiple',
  theme: {
    preference: 'system',
    light: { accent: { primary: '#9E2B47', primaryHover: '#86213A', primaryActive: '#6F1B30', primaryLight: '#F5DDE3', primaryForeground: '#FFFFFF' }, background: { app: '#EFE6DA', surface: '#FFFBF5', surfaceAlt: '#F7F1E8' }, border: { default: '#E6DCCF', subtle: '#EFE6DA' } },
    dark: { accent: { primary: '#D9708A', primaryHover: '#E48AA0', primaryActive: '#C85B76', primaryLight: '#4A2533', primaryForeground: '#2A0F17' }, background: { app: '#1B161C', surface: '#241D26', surfaceAlt: '#2C232E' }, border: { default: '#3A2F3B', subtle: '#2C232E' } },
  },
});
const registry = await viewerEl.registry;
const cap = id => registry.getPlugin(id)?.provides?.();
const dm = cap('document-manager'), ex = cap('export');

/* ---------- which open document is which file ----------
   docs: documentId -> {
     name, handle        the file it came from (handle only when the browser lets us find it again)
     original            the file's bytes as they were when opened here (for Back to original)
     latest              the document's bytes after the newest change (what is, or should be, in the file)
     seen                the file's size and date when we last read or wrote it (to notice changes made elsewhere)
     touched             something was changed since it was opened
     dirty               the newest change is not in the file yet
     rw                  true/false once the browser has said whether we may write to the file
     conflict            the file was changed outside the Reader: saving as you go stops until you choose
     busy, again, err    the save in progress
   } */
const docs = new Map();
const activeId = () => { try { return dm.getActiveDocument?.()?.id ?? dm.getActiveDocumentId?.() ?? null; } catch (e) { return null; } };
let autoOn = LS.get('reader:auto', true);
const canAuto = d => autoOn && d.handle && d.handle.createWritable && d.rw !== false && !d.conflict;

function showState() {
  const d = docs.get(activeId()), any = docs.size > 0;
  $('#empty').hidden = any; $('#saveBtn').disabled = !d; $('#saveAsBtn').disabled = !d; $('#revertBtn').disabled = !(d && d.touched);
  const st = $('#state'); let text = '', warn = false;
  if (d) {
    if (d.conflict) { text = `${d.name} · changed outside the Reader: not saving over it`; warn = true; }
    else if (d.err) { text = `${d.name} · not saved: ${d.err}`; warn = true; }
    else if (d.dirty && d.busy && canAuto(d)) text = `${d.name} · saving…`;
    else if (d.dirty) { text = `${d.name} · ${!d.handle ? 'changes are not in a file yet: Save a copy…' : !autoOn ? 'unsaved changes' : 'press Save once to let the Reader save as you go'}`; warn = true; }
    else text = d.touched ? `${d.name} · saved` : d.name;
  }
  st.textContent = text; st.title = text; st.classList.toggle('dirty', warn);
}

/* ---------- saving ---------- */
const bytesOf = async id => new Blob([await done(ex.forDocument(id).saveAsCopy())], { type: 'application/pdf' }); // always this document, whichever tab is in front
async function writeBack(d, blob, { force = false } = {}) {
  if (!force && d.seen) { // was the file changed by something else since we last read or wrote it?
    const f = await d.handle.getFile();
    if (f.lastModified !== d.seen.at || f.size !== d.seen.size) { d.conflict = true; const e = new Error('changed outside'); e.conflict = true; throw e; }
  }
  const w = await d.handle.createWritable(); await w.write(blob); await w.close(); // written beside the file and swapped in whole: never half a file
  const g = await d.handle.getFile(); d.seen = { at: g.lastModified, size: g.size }; d.conflict = false;
}
// May we write to this file? Asked the first time it is needed; the browser only shows its question after a click or key.
async function allowed(d) {
  if (d.rw === true) return true;
  try {
    if ((await d.handle.queryPermission({ mode: 'readwrite' })) === 'granted') return (d.rw = true);
    const r = await d.handle.requestPermission({ mode: 'readwrite' });
    d.rw = r === 'granted' ? true : r === 'denied' ? false : undefined; return d.rw === true;
  } catch (e) { return false; } // no click to hang the question on: Save asks again
}
// Something in a document changed: take its bytes, and put them in its file if we may. One save at a time per
// document; changes made while one is running are picked up by one more pass.
async function changed(id) {
  const d = docs.get(id ?? activeId()); if (!d) return;
  d.touched = true; d.dirty = true; d.err = '';
  if (d.busy) { d.again = true; return; }
  d.busy = true; showState();
  try {
    do {
      d.again = false;
      const blob = await bytesOf(d.id); d.latest = blob;
      if (canAuto(d) && await allowed(d)) { await writeBack(d, blob); if (!d.again) d.dirty = false; }
    } while (d.again);
  } catch (e) { if (!e.conflict && docs.has(d.id)) d.err = e?.message || String(e); }
  finally { d.busy = false; showState(); }
}
// What the viewer tells us. Opening a document also sends events ("loaded"), which are not changes; an undo that
// takes back the only change is one (the file must go back too).
cap('annotation')?.onAnnotationEvent?.(e => { if (e && /^(create|update|delete|add|remove|move|commit)/i.test(e.type || '')) changed(e.documentId); });
cap('form')?.onFieldValueChange?.(e => changed(e?.documentId));
cap('history')?.onHistoryChange?.(e => { const d = docs.get(e?.documentId ?? activeId()); if (d && ((e?.state?.global?.canUndo ?? true) || d.touched)) changed(d.id); });
dm.onActiveDocumentChanged?.(showState);
dm.onDocumentClosed?.(e => {
  const id = e?.documentId ?? e?.id ?? e, d = docs.get(id); docs.delete(id); showState();
  if (d && d.dirty && d.latest && !d.leaving) toast(`“${d.name}” was closed with changes that are not in a file.`, 30000, [['Save a copy…', () => saveBlobAs(d.latest, d.name)], ['Open it again', () => openBlob(d.latest, d.name, d.handle, { ...d, busy: false, again: false })]]);
});

async function save() { // the Save button: write now, and settle anything that stopped saving as you go
  const d = docs.get(activeId()); if (!d) return;
  if (!d.handle || !d.handle.createWritable) return saveAs();
  try {
    if (!(await allowed(d))) return toast('Saving needs your permission to change the file. Allow it, or use Save a copy….', 6000);
    if (d.conflict && !confirm(`“${d.name}” was changed outside the Reader after you opened it here.\n\nSave over it anyway? Whatever was changed there will be lost. (Cancel, then Save a copy… keeps both.)`)) return;
    const blob = await bytesOf(d.id); d.latest = blob; await writeBack(d, blob, { force: true });
    d.dirty = false; d.err = ''; d.touched = true; showState(); toast(`Saved “${d.name}”.`);
  } catch (e) { toast(`Could not save: ${e?.message || e}`, 7000); }
}
async function saveBlobAs(blob, fromName, d) {
  const name = fromName.replace(/(\.pdf)?$/i, '.pdf');
  try {
    if (window.showSaveFilePicker) {
      let h; try { h = await showSaveFilePicker({ suggestedName: name.replace(/\.pdf$/i, ' (copy).pdf'), id: 'reader-save', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); } catch (e) { if (e.name === 'AbortError') return; throw e; }
      const w = await h.createWritable(); await w.write(blob); await w.close();
      const f = await h.getFile();
      if (d) { Object.assign(d, { handle: h, name: h.name, dirty: false, err: '', conflict: false, rw: true, seen: { at: f.lastModified, size: f.size }, original: blob, touched: false }); showState(); }
      remember(f, h); toast(d ? `Saved as “${h.name}”. Changes from now on go into this copy.` : `Saved as “${h.name}”.`, 5000);
    } else {
      const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60e3);
      if (d) { d.dirty = false; showState(); } toast(`“${name}” saved to your Downloads.`);
    }
  } catch (e) { toast(`Could not save: ${e?.message || e}`, 7000); }
}
async function saveAs() { const d = docs.get(activeId()); if (!d) return; try { await saveBlobAs(await bytesOf(d.id), d.name, d); } catch (e) { toast(`Could not save: ${e?.message || e}`, 7000); } }

// Back to original: the file as it was when it was opened here, whatever was changed and saved since.
let revertT = 0;
function armRevert(on) { const b = $('#revertBtn'); clearTimeout(revertT); b.dataset.armed = on ? '1' : ''; b.textContent = on ? 'Undo every change?' : 'Back to original'; if (on) revertT = setTimeout(() => armRevert(false), 4000); }
async function revert() {
  const d = docs.get(activeId()); if (!d || !d.touched) return;
  if (!$('#revertBtn').dataset.armed) return armRevert(true);
  armRevert(false);
  try {
    if (d.handle && d.handle.createWritable) { if (!(await allowed(d))) return toast('Putting the file back needs your permission to change it.', 6000); await writeBack(d, d.original, { force: true }); }
    d.leaving = true; d.dirty = false; await done(dm.closeDocument(d.id));
    await openBlob(d.original, d.name, d.handle, { rw: d.rw, seen: d.seen });
    toast(`“${d.name}” is back as it was when you opened it.`, 5000);
  } catch (e) { toast(`Could not put it back: ${e?.message || e}`, 7000); }
}

$('#saveBtn').addEventListener('click', save);
$('#saveAsBtn').addEventListener('click', saveAs);
$('#revertBtn').addEventListener('click', revert);
$('#autoChk').checked = autoOn;
$('#autoChk').addEventListener('change', e => { autoOn = e.target.checked; LS.set('reader:auto', autoOn); showState(); if (autoOn) for (const d of docs.values()) if (d.dirty) changed(d.id); });
addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey; if (!ctrl) return;
  if (e.key === 's' || e.key === 'S') { e.preventDefault(); e.shiftKey ? saveAs() : save(); }
  else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); pick(); }
}, true);
addEventListener('beforeunload', e => { if ([...docs.values()].some(d => d.dirty || d.busy)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- opening ---------- */
async function openBlob(blob, name, handle, carry = {}) {
  const buffer = await blob.arrayBuffer(), original = carry.original || new Blob([buffer], { type: 'application/pdf' }); // our own copy: the viewer keeps the buffer
  const r = await done(dm.openDocumentBuffer({ buffer, name, autoActivate: true }));
  const id = r?.documentId ?? r;
  docs.set(id, { id, name, handle: handle || null, original, latest: carry.latest || null, seen: carry.seen || null, touched: !!carry.touched, dirty: !!carry.dirty, rw: carry.rw, conflict: !!carry.conflict, busy: false, again: false, err: '' });
  showState(); return id;
}
async function openFile(file, handle) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast(`“${file.name}” is not a PDF. Word, ePub, Markdown and other formats come next.`, 6000);
  try {
    if (handle) for (const d of docs.values()) { // the same file twice would be two copies fighting over one file
      if (d.handle && await d.handle.isSameEntry(handle).catch(() => false)) { dm.setActiveDocument(d.id); showState(); return toast(`“${d.name}” is already open: here it is.`); }
    }
    await openBlob(file, file.name, handle, { seen: { at: file.lastModified, size: file.size } });
    remember(file, handle);
  } catch (e) { toast(`Could not open “${file.name}”: ${e?.message || e}`, 7000); }
}
async function pick() {
  if (!window.showOpenFilePicker) return $('#fileIn').click();
  let hs; try { hs = await showOpenFilePicker({ multiple: true, id: 'reader-open', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); } catch (e) { if (e.name !== 'AbortError') $('#fileIn').click(); return; }
  for (const h of hs) await openFile(await h.getFile(), h);
}
for (const b of ['#openBtn', '#openBtn2']) $(b).addEventListener('click', pick);
$('#fileIn').addEventListener('change', async e => { for (const f of e.target.files) await openFile(f); e.target.value = ''; });
let dragN = 0;
addEventListener('dragenter', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragN++; $('#veil').hidden = false; } });
addEventListener('dragleave', () => { dragN = Math.max(0, dragN - 1); if (!dragN) $('#veil').hidden = true; });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', async e => {
  e.preventDefault(); dragN = 0; $('#veil').hidden = true; const dt = e.dataTransfer; if (!dt?.files?.length) return;
  const items = [...(dt.items || [])].filter(i => i.kind === 'file'), hs = items[0]?.getAsFileSystemHandle ? items.map(i => i.getAsFileSystemHandle().catch(() => null)) : null, plain = [...dt.files];
  const got = hs ? await Promise.all(hs) : [];
  for (let k = 0; k < plain.length; k++) { const h = got[k]; await openFile(h && h.kind === 'file' ? await h.getFile() : plain[k], h && h.kind === 'file' ? h : null); }
});
if ('launchQueue' in window) launchQueue.setConsumer(async p => { for (const h of p.files || []) await openFile(await h.getFile(), h); });

/* ---------- Recent: documents opened before, found again by their handle (nothing is copied) ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('reader-recent', 1); r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'key' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx(mode, fn) { const d = await idb(); return new Promise((res, rej) => { let out; const t = d.transaction('docs', mode), r = fn(t.objectStore('docs')); if (r) r.onsuccess = () => { out = r.result; }; t.oncomplete = () => { d.close(); res(out); }; t.onerror = () => { d.close(); rej(t.error); }; }); }
const recentList = async () => (await tx('readonly', o => o.getAll()).catch(() => [])).sort((a, b) => b.at - a.at);
async function remember(file, handle) {
  if (!handle) return; // only files that can be found again are listed (picked or dropped in Chrome or Edge)
  const all = await recentList(), same = [];
  for (const r of all) { try { if (await r.handle.isSameEntry(handle)) same.push(r.key); } catch (e) {} }
  await tx('readwrite', o => { for (const k of same) o.delete(k); return o.put({ key: `${Date.now()}-${file.name}`, name: file.name, size: file.size, at: Date.now(), handle }); }).catch(() => {});
  const extra = (await recentList()).slice(20);
  if (extra.length) await tx('readwrite', o => { for (const r of extra) o.delete(r.key); }).catch(() => {});
}
async function drawRecent() {
  const list = await recentList(), m = $('#menu');
  m.innerHTML = `<div class="lbl">Opened before</div>` + (list.length
    ? list.map((r, i) => `<div class="rrow"><button class="open" data-i="${i}"><span>${esc(r.name)}</span><small>${new Date(r.at).toLocaleString()} · ${(r.size / 1e6).toFixed(1)} MB</small></button><button class="rm" data-rm="${i}" title="Take this one off the list (the file itself is not touched)" aria-label="Take ${esc(r.name)} off the list">✕</button></div>`).join('') + `<button class="clear" data-clear>Clear this list</button>`
    : '<div class="lbl">Nothing yet. Documents you open with Open… or by dropping them show up here.</div>');
  m.onclick = async ev => {
    const rm = ev.target.closest('[data-rm]'), op = ev.target.closest('[data-i]');
    if (ev.target.closest('[data-clear]')) { await tx('readwrite', o => o.clear()).catch(() => {}); return drawRecent(); }
    if (rm) { await tx('readwrite', o => o.delete(list[+rm.dataset.rm].key)).catch(() => {}); return drawRecent(); }
    if (!op) return; m.hidden = true; const r = list[+op.dataset.i];
    try { if ((await r.handle.queryPermission({ mode: 'read' })) !== 'granted' && (await r.handle.requestPermission({ mode: 'read' })) !== 'granted') return toast('The browser was not allowed to read it. Open it again with Open….'); await openFile(await r.handle.getFile(), r.handle); }
    catch (err) { toast(`“${r.name}” could not be opened from where it was. It may have been moved or deleted.`, 6000); }
  };
}
$('#recentBtn').addEventListener('click', async e => {
  const btn = e.currentTarget, m = $('#menu'); // read the button now: after an await the event no longer knows it
  await drawRecent();
  const rc = btn.getBoundingClientRect(); m.hidden = false; m.style.top = rc.bottom + 6 + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, rc.right - m.offsetWidth)) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.hidden = true; document.removeEventListener('pointerdown', off); } }), 0);
});

showState();
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__reader = { registry, dm, ex, docs, openFile, save, saveAs, activeId, cap, changed };
