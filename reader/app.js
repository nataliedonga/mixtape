/* Reader: open a PDF, read it, mark it up (highlight, underline, strike out, notes, drawing, shapes, stamps), fill its
   forms, sign it, and save it back into the same file. The viewer is EmbedPDF (MIT; Google's PDFium compiled to
   WebAssembly), in ../vendor/embedpdf with its licence; every outside download it would make by default (its engine,
   fonts, stamp sets, Google webfonts) is pointed at the copies here or switched off, so it works offline and nothing
   is fetched while a document is open. Nothing is ever uploaded.
   Redaction is switched off until it has its own check that the blacked-out words are really gone from the saved
   file (a box drawn over words leaves them in the file; that has leaked court papers). */
import EmbedPDF from '../vendor/embedpdf/embedpdf.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let toastT = 0; const toast = (m, ms = 3500) => { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms); };
const V = new URL('../vendor/embedpdf/', import.meta.url).href;
// a task from the viewer (it has its own promise-like type) as a promise
const done = t => (t && typeof t.toPromise === 'function' ? t.toPromise() : new Promise((res, rej) => t.wait(res, e => rej(e && (e.reason || e)))));

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

/* ---------- which open document is which file ---------- */
const docs = new Map(); // documentId -> { name, handle?, dirty }
const activeId = () => { try { return dm.getActiveDocument?.()?.id ?? dm.getActiveDocumentId?.() ?? null; } catch (e) { return null; } };
function showState() {
  const d = docs.get(activeId()), any = docs.size > 0;
  $('#empty').hidden = any; $('#saveBtn').disabled = !d; $('#saveAsBtn').disabled = !d;
  const st = $('#state'); st.classList.toggle('dirty', !!(d && d.dirty));
  st.textContent = !d ? '' : d.dirty ? `${d.name} · unsaved changes` : d.name;
}
// a real change (an annotation made, changed or removed, a form field filled, an undo step) marks that document
// unsaved; opening a document also sends events ("loaded"), which are not changes
function markDirty(docId) { const d = docs.get(docId ?? activeId()); if (d && !d.dirty) { d.dirty = true; showState(); } }
cap('annotation')?.onAnnotationEvent?.(e => { if (e && /^(create|update|delete|add|remove|move|commit)/i.test(e.type || '')) markDirty(e.documentId); });
cap('form')?.onFieldValueChange?.(e => markDirty(e?.documentId));
cap('history')?.onHistoryChange?.(e => { if (e?.state?.global?.canUndo ?? e?.canUndo ?? true) markDirty(e?.documentId); });
dm.onActiveDocumentChanged?.(showState); dm.onDocumentClosed?.(e => { docs.delete(e?.documentId ?? e?.id ?? e); showState(); });

/* ---------- opening ---------- */
async function openFile(file, handle) {
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return toast(`“${file.name}” is not a PDF. Word, ePub, Markdown and other formats come next.`, 6000);
  try {
    const buffer = await file.arrayBuffer();
    const r = await done(dm.openDocumentBuffer({ buffer, name: file.name, autoActivate: true }));
    const id = r?.documentId ?? r; docs.set(id, { name: file.name, handle: handle || null, dirty: false });
    remember(file, handle); showState();
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

/* ---------- saving: back into the same file, or a copy ---------- */
async function bytesOfActive() { const buf = await done(ex.saveAsCopy()); return new Blob([buf], { type: 'application/pdf' }); }
async function save() {
  const id = activeId(), d = docs.get(id); if (!d) return;
  if (!d.handle || !d.handle.createWritable) return saveAs();
  try {
    if ((await d.handle.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await d.handle.requestPermission({ mode: 'readwrite' })) !== 'granted') return toast('Saving needs your permission to change the file. Use Save a copy instead, or allow it.', 6000);
    const blob = await bytesOfActive(), w = await d.handle.createWritable(); await w.write(blob); await w.close();
    d.dirty = false; showState(); toast(`Saved “${d.name}”.`);
  } catch (e) { toast(`Could not save: ${e?.message || e}`, 7000); }
}
async function saveAs() {
  const id = activeId(), d = docs.get(id); if (!d) return;
  try {
    const blob = await bytesOfActive(), name = d.name.replace(/(\.pdf)?$/i, '.pdf');
    if (window.showSaveFilePicker) {
      let h; try { h = await showSaveFilePicker({ suggestedName: name.replace(/\.pdf$/i, ' (marked up).pdf'), id: 'reader-save', types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] }); } catch (e) { if (e.name === 'AbortError') return; throw e; }
      const w = await h.createWritable(); await w.write(blob); await w.close();
      d.handle = h; d.name = h.name; d.dirty = false; remember(await h.getFile(), h); showState(); toast(`Saved as “${h.name}”. Save now writes to this copy.`, 5000);
    } else {
      const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 60e3);
      d.dirty = false; showState(); toast(`“${name}” saved to your Downloads.`);
    }
  } catch (e) { toast(`Could not save: ${e?.message || e}`, 7000); }
}
$('#saveBtn').addEventListener('click', save);
$('#saveAsBtn').addEventListener('click', saveAs);
addEventListener('keydown', e => {
  const ctrl = e.ctrlKey || e.metaKey; if (!ctrl) return;
  if (e.key === 's' || e.key === 'S') { e.preventDefault(); e.shiftKey ? saveAs() : save(); }
  else if (e.key === 'o' || e.key === 'O') { e.preventDefault(); pick(); }
}, true);
addEventListener('beforeunload', e => { if ([...docs.values()].some(d => d.dirty)) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Recent: documents opened before, found again by their handle (nothing is copied) ---------- */
const idb = () => new Promise((res, rej) => { const r = indexedDB.open('reader-recent', 1); r.onupgradeneeded = () => r.result.createObjectStore('docs', { keyPath: 'key' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx(mode, fn) { const d = await idb(); return new Promise((res, rej) => { let out; const t = d.transaction('docs', mode), r = fn(t.objectStore('docs')); if (r) r.onsuccess = () => { out = r.result; }; t.oncomplete = () => { d.close(); res(out); }; t.onerror = () => { d.close(); rej(t.error); }; }); }
async function remember(file, handle) {
  if (!handle) return; // only files that can be found again are listed (picked or dropped in Chrome or Edge)
  const all = await tx('readonly', o => o.getAll()).catch(() => []), same = [];
  for (const r of all) { try { if (await r.handle.isSameEntry(handle)) same.push(r.key); } catch (e) {} }
  await tx('readwrite', o => { for (const k of same) o.delete(k); return o.put({ key: `${Date.now()}-${file.name}`, name: file.name, size: file.size, at: Date.now(), handle }); }).catch(() => {});
  const keep = (await tx('readonly', o => o.getAll()).catch(() => [])).sort((a, b) => b.at - a.at).slice(20);
  if (keep.length) await tx('readwrite', o => { for (const r of keep) o.delete(r.key); }).catch(() => {});
}
$('#recentBtn').addEventListener('click', async e => {
  const btn = e.currentTarget; // read it now: after the await below the event no longer knows its button
  const list = (await tx('readonly', o => o.getAll()).catch(() => [])).sort((a, b) => b.at - a.at), m = $('#menu');
  m.innerHTML = `<div class="lbl">Opened before</div>` + (list.length ? list.map((r, i) => `<button data-i="${i}"><span>${esc(r.name)}</span><small>${new Date(r.at).toLocaleString()} · ${(r.size / 1e6).toFixed(1)} MB</small></button>`).join('') : '<div class="lbl">Nothing yet. Documents you open with Open… or by dropping them show up here.</div>');
  const rc = btn.getBoundingClientRect(); m.hidden = false; m.style.top = rc.bottom + 6 + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, rc.right - m.offsetWidth)) + 'px';
  m.onclick = async ev => {
    const b = ev.target.closest('[data-i]'); if (!b) return; m.hidden = true; const r = list[+b.dataset.i];
    try { if ((await r.handle.queryPermission({ mode: 'read' })) !== 'granted' && (await r.handle.requestPermission({ mode: 'read' })) !== 'granted') return toast('The browser was not allowed to read it. Open it again with Open….'); await openFile(await r.handle.getFile(), r.handle); }
    catch (err) { toast(`“${r.name}” could not be opened from where it was. It may have been moved or deleted.`, 6000); }
  };
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.hidden = true; document.removeEventListener('pointerdown', off); } }), 0);
});

showState();
if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__reader = { registry, dm, ex, docs, openFile, save, saveAs, activeId, cap };
