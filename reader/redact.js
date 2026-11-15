/* Redaction with a check. Mark what must go (drag a box over it, or find words and black out every match), then
   "Black out and save a new file". The document you have open is never changed: the result is always a NEW file.

   REMOVED, NOT COVERED. For each marked page, on a private copy of the document:
     1. the viewer's engine (PDFium) deletes the text under each box from the page itself (also text that is in the
        file but invisible, such as the layer a scanner's OCR adds);
     2. notes, links and form fields that touch a box are deleted, and form fields left without a place on a page
        are dropped from the form (their values go with them);
     3. the page is drawn WITHOUT the black boxes and the pixels under each box are looked at. If they are not one
        flat colour, something that is not text is still there (a picture, a drawn signature, a stamp), and the engine
        cannot cut that out. Then, and for pages that are turned sideways, the whole page is replaced by a picture
        of itself with the boxes burnt in: nothing of the old page is kept. The report says which pages became
        pictures (their text can no longer be selected or searched).
     4. the document's information (title, author, subject, keywords…), its embedded description (XMP) and its
        bookmarks lose anything that contains a blacked-out passage;
     5. every object nothing refers to any more is dropped, and the file is written fresh (no earlier version of a
        page is left behind in it).

   THE CHECK, on the bytes that will be saved, before anything is saved:
     a. the file is opened again by the engine and all its text taken out; every blacked-out passage is searched for;
     b. every string and every unpacked stream in the file is searched for every passage (and the raw bytes);
     c. no letter may be left inside any box, and no note, link or form field may touch one.
   Only if all of that is clean does the report say "Checked: none of the N blacked-out passages can be found in the
   saved file" and offer to save. Otherwise it says what was found and where, and nothing is saved as "redacted".
   Protected (encrypted) PDFs are refused: their bytes cannot be rewritten and searched this way. */
import { lib, load, sweep, saveNew } from './pages.js';

const $ = s => document.querySelector(s);
const wait = t => (t && typeof t.toPromise === 'function' ? t.toPromise() : new Promise((res, rej) => t.wait(res, e => rej(e && (e.reason || e)))));
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const shown = p => (p.rotation % 2 ? { w: p.size.height, h: p.size.width } : { w: p.size.width, h: p.size.height }); // the page as displayed, in points
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const er = r => ({ origin: { x: r.x, y: r.y }, size: { width: r.w, height: r.h } });
const re = r => ({ x: r.origin.x, y: r.origin.y, w: r.size.width, h: r.size.height });
let hooks = {}, S = null;

async function canvasOf(eng, doc, page, scale) {
  const blob = await wait(eng.renderPage(doc, page, { scaleFactor: scale, rotation: page.rotation, withAnnotations: true, withForms: true })), bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d', { willReadFrequently: true }).drawImage(bmp, 0, 0); bmp.close?.(); return c;
}
function flat(canvas, r, scale) { // are the pixels under this box one flat colour (nothing painted there)?
  const x = Math.ceil(r.x * scale) + 2, y = Math.ceil(r.y * scale) + 2, w = Math.floor(r.w * scale) - 4, h = Math.floor(r.h * scale) - 4;
  if (w < 1 || h < 1) return true;
  const d = canvas.getContext('2d').getImageData(Math.max(0, x), Math.max(0, y), w, h).data;
  for (let i = 4; i < d.length; i += 4) if (Math.abs(d[i] - d[0]) > 10 || Math.abs(d[i + 1] - d[1]) > 10 || Math.abs(d[i + 2] - d[2]) > 10) return false;
  return true;
}
function black(canvas, r, scale) { // is the box solid black in the finished page?
  const x = Math.ceil(r.x * scale) + 2, y = Math.ceil(r.y * scale) + 2, w = Math.floor(r.w * scale) - 4, h = Math.floor(r.h * scale) - 4;
  if (w < 1 || h < 1) return true;
  const d = canvas.getContext('2d').getImageData(Math.max(0, x), Math.max(0, y), w, h).data;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) return false;
  return true;
}
async function wordsUnder(eng, doc, page, boxes) { // the letters whose middle lies inside each box
  const [glyphs, text] = [await wait(eng.getPageGlyphs(doc, page)), await wait(eng.extractText(doc, [page.index]))];
  return boxes.map(b => { let s = ''; if (glyphs.length === text.length) glyphs.forEach((g, i) => { const cx = g.origin.x + g.size.width / 2, cy = g.origin.y + g.size.height / 2; if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) s += text[i]; }); return s; });
}

/* The whole job. marks: [{ page, x, y, w, h, text? }] in points on the page as displayed (top-left origin).
   -> { bytes, report: { ok, passages, lines, failures, elsewhere, pictures } } */
export async function redact(bytes, marks, eng, say = () => {}) {
  const P = await lib(); await load(bytes); // refuses protected PDFs before any work
  const id = 'redact-' + Date.now(), doc = await wait(eng.openDocumentBuffer({ id, content: bytes.slice().buffer }));
  const byPage = new Map(); for (const m of marks) (byPage.get(m.page) || byPage.set(m.page, []).get(m.page)).push(m);
  const passages = new Set(), picture = new Map(), why = new Map(); let removedAnnots = 0;
  try {
    for (const [pi, boxes] of byPage) {
      const page = doc.pages[pi]; say(`Removing what is under the boxes on page ${pi + 1}…`);
      const under = await wordsUnder(eng, doc, page, boxes);
      boxes.forEach((b, k) => { for (const s of [b.text, under[k]]) if (norm(s).replace(/ /g, '').length >= 3) passages.add(norm(s)); });
      let asPicture = page.rotation ? 'it is turned sideways' : '';
      if (!asPicture) {
        try { await wait(eng.redactTextInRects(doc, page, boxes.map(er), { recurseForms: true, drawBlackBoxes: false })); } catch (e) { asPicture = 'the engine could not remove its text'; }
        try { for (const a of await wait(eng.getPageAnnotations(doc, page))) if (a.rect && boxes.some(b => hits(b, re(a.rect)))) { await wait(eng.removePageAnnotation(doc, page, a)); removedAnnots++; } } catch (e) { asPicture ||= 'a note, link or form field under a box could not be removed'; }
      }
      if (!asPicture) { const c = await canvasOf(eng, doc, page, 2), sc = c.width / shown(page).w; if (!boxes.every(b => flat(c, b, sc))) asPicture = 'a picture, drawing or stamp lies under a box'; } // the scale is measured from the picture, never assumed
      if (asPicture) { // the page becomes a picture of itself with the boxes burnt in
        const size = shown(page), c = await canvasOf(eng, doc, page, Math.min(200 / 72, 2600 / Math.max(size.w, size.h))), sc = c.width / size.w, g = c.getContext('2d');
        g.fillStyle = '#000'; for (const b of boxes) g.fillRect(Math.floor(b.x * sc) - 1, Math.floor(b.y * sc) - 1, Math.ceil(b.w * sc) + 2, Math.ceil(b.h * sc) + 2);
        const jpg = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
        picture.set(pi, { jpg: new Uint8Array(await jpg.arrayBuffer()), ...size }); why.set(pi, asPicture);
      }
    }
    say('Writing the new file…');
    var mid = new Uint8Array(await wait(eng.saveAsCopy(doc)));
  } finally { try { await wait(eng.closeDocument(doc)); } catch (e) {} }

  const pd = await load(mid), ctx = pd.context, N = P.PDFName.of, pages = pd.getPages(), val = v => (v instanceof P.PDFRef ? ctx.lookup(v) : v);
  for (const [pi, boxes] of byPage) {
    const pg = pages[pi], pic = picture.get(pi);
    if (pic) {
      for (const k of [...pg.node.keys()]) if (k !== N('Type') && k !== N('Parent')) pg.node.delete(k);
      pg.node.set(N('MediaBox'), ctx.obj([0, 0, pic.w, pic.h]));
      pg.drawImage(await pd.embedJpg(pic.jpg), { x: 0, y: 0, width: pic.w, height: pic.h });
    } else {
      const box = pg.getCropBox();
      for (const b of boxes) pg.drawRectangle({ x: box.x + b.x, y: box.y + box.height - b.y - b.h, width: b.w, height: b.h, color: P.rgb(0, 0, 0) });
    }
  }
  // form fields that no longer have a place on any page: out of the form, with their values
  const form = val(pd.catalog.get(N('AcroForm')));
  if (form instanceof P.PDFDict && (removedAnnots || picture.size)) {
    const on = new Set(); for (const pg of pages) { const an = val(pg.node.get(N('Annots'))); if (an instanceof P.PDFArray) for (const a of an.asArray()) if (a instanceof P.PDFRef) on.add(a.tag); }
    const alive = (ref, depth) => { const f = val(ref); if (!(f instanceof P.PDFDict) || depth > 30) return false; const kids = val(f.get(N('Kids'))); if (!(kids instanceof P.PDFArray)) return ref instanceof P.PDFRef && on.has(ref.tag); for (let i = kids.size() - 1; i >= 0; i--) if (!alive(kids.get(i), depth + 1)) kids.remove(i); return kids.size() > 0; };
    const fields = val(form.get(N('Fields'))); if (fields instanceof P.PDFArray) for (let i = fields.size() - 1; i >= 0; i--) if (!alive(fields.get(i), 0)) fields.remove(i);
    form.delete(N('XFA'));
  }
  // information, description and bookmarks that contain a passage
  const list = [...passages], has = t => { const n = norm(t); return list.some(p => n.includes(p)); }, txt = v => { try { return v.decodeText(); } catch (e) { return ''; } };
  let infoCut = 0, marksCut = 0, xmpCut = false;
  const info = val(ctx.trailerInfo.Info); if (info instanceof P.PDFDict) for (const [k, v] of info.entries()) if (has(txt(val(v)))) { info.delete(k); infoCut++; }
  const xmp = val(pd.catalog.get(N('Metadata'))); if (xmp && (xmp instanceof P.PDFStream)) { let t = ''; try { t = new TextDecoder().decode(P.decodePDFRawStream(xmp).decode()); } catch (e) { t = list.length ? list[0] : ''; } if (has(t)) { pd.catalog.delete(N('Metadata')); xmpCut = true; } }
  const walk = (parent, depth) => { let r = parent.get(N('First')), n = 0; while (r instanceof P.PDFRef && n++ < 20000) { const it = ctx.lookup(r); if (!(it instanceof P.PDFDict)) break; if (has(txt(val(it.get(N('Title')))))) { it.set(N('Title'), P.PDFHexString.fromText('[blacked out]')); marksCut++; } if (depth < 40) walk(it, depth + 1); r = it.get(N('Next')); } };
  const outline = val(pd.catalog.get(N('Outlines'))); if (outline instanceof P.PDFDict) walk(outline, 0);
  sweep(P, ctx);
  const out = await pd.save({ updateFieldAppearances: false });
  say('Checking the new file…');
  const report = await check(out, marks, list, eng, new Set(picture.keys()));
  report.pictures = [...picture.keys()].sort((a, b) => a - b).map(pi => ({ page: pi + 1, why: why.get(pi) }));
  report.cut = { infoCut, marksCut, xmpCut, removedAnnots };
  return { bytes: out, report };
}

/* The check: everything here reads the finished bytes, not what the steps above believe they did. */
export async function check(bytes, marks, passages, eng, picturePages = new Set()) {
  const P = await lib(), failures = [], elsewhere = [], lines = [];
  // a. through the engine
  const doc = await wait(eng.openDocumentBuffer({ id: 'recheck-' + Date.now(), content: bytes.slice().buffer }));
  try {
    const texts = []; for (const p of doc.pages) texts.push(norm(await wait(eng.extractText(doc, [p.index]))));
    for (const s of passages) texts.forEach((t, pi) => { if (t.includes(s) || t.replace(/ /g, '').includes(s.replace(/ /g, ''))) { const inBox = marks.some(m => m.page === pi); (inBox && picturePages.has(pi) ? failures : elsewhere).push({ passage: s, page: pi + 1 }); } });
    const byPage = new Map(); for (const m of marks) (byPage.get(m.page) || byPage.set(m.page, []).get(m.page)).push(m);
    for (const [pi, boxes] of byPage) {
      const left = (await wordsUnder(eng, doc, doc.pages[pi], boxes)).map(s => s.replace(/\s+/g, '')).filter(Boolean);
      if (left.length) failures.push({ page: pi + 1, what: `letters are still inside a box (“${left.join(' ').slice(0, 40)}”)` });
      for (const a of await wait(eng.getPageAnnotations(doc, doc.pages[pi]))) if (a.rect && boxes.some(b => hits(b, re(a.rect)))) failures.push({ page: pi + 1, what: 'a note, link or form field still touches a box' });
      { const c = await canvasOf(eng, doc, doc.pages[pi], 1.5), sc = c.width / shown(doc.pages[pi]).w; if (!boxes.every(b => black(c, b, sc))) failures.push({ page: pi + 1, what: 'a box is not solid black in the new file' }); }
      if (picturePages.has(pi) && (await wait(eng.getPageGlyphs(doc, doc.pages[pi]))).length) failures.push({ page: pi + 1, what: 'a page that should be only a picture still carries text' });
    }
    lines.push(`Opened the new file again and read all the text on its ${plural(doc.pages.length, 'page', 'pages')}.`);
  } finally { try { await wait(eng.closeDocument(doc)); } catch (e) {} }
  // b. through the bytes: every string and every unpacked stream of every object
  const pd = await P.PDFDocument.load(bytes, { updateMetadata: false }), dec = new TextDecoder('latin1'), raw = norm(dec.decode(bytes)); let objects = 0, streams = 0;
  const found = new Set(), seenText = new Set(), look = t => { const n = norm(t), tight = n.replace(/ /g, ''); if (n.length < 2e6) seenText.add(n); for (const s of passages) if (n.includes(s) || tight.includes(s.replace(/ /g, ''))) found.add(s); };
  look(raw);
  const seen = new Set(), dig = o => {
    if (!o || seen.has(o)) return; if (typeof o === 'object') seen.add(o);
    if (o instanceof P.PDFString || o instanceof P.PDFHexString) { try { look(o.decodeText()); } catch (e) {} try { look(o.asString ? o.asString() : ''); } catch (e) {} }
    else if (o instanceof P.PDFName) { try { look(o.decodeText()); } catch (e) {} }
    else if (o instanceof P.PDFDict) for (const [k, v] of o.entries()) { dig(k); dig(v); }
    else if (o instanceof P.PDFArray) for (const v of o.asArray()) dig(v);
    else if (o instanceof P.PDFStream) { streams++; dig(o.dict); let b = null; try { b = o instanceof P.PDFRawStream ? P.decodePDFRawStream(o).decode() : o.getContents(); } catch (e) { b = o.contents || null; } if (b && b.length < 40e6) { look(dec.decode(b)); try { look(new TextDecoder('utf-8').decode(b)); } catch (e) {} } }
  };
  for (const [, obj] of pd.context.enumerateIndirectObjects()) { objects++; dig(obj); }
  for (const s of found) if (!elsewhere.some(e => e.passage === s) && !failures.some(f => f.passage === s)) failures.push({ passage: s, what: 'is still in the file outside the visible text (in its information, a bookmark, a form or a hidden part)' });
  const advice = [], whole = norm(raw + ' ' + [...seenText].join(' '));
  for (const w of new Set(passages.flatMap(p => p.split(/[^\p{L}\p{N}]+/u)).filter(w => w.length >= 5))) if (whole.includes(w) && !found.has(w)) advice.push(w);
  lines.push(`Searched the file itself: ${objects.toLocaleString()} parts, ${streams.toLocaleString()} of them unpacked, and the raw bytes.`);
  lines.push('Looked inside every box for letters left behind, and for notes, links or form fields touching it.');
  lines.push('Drew each marked page again and looked at every box: each must be solid black.');
  return { ok: !failures.length && !elsewhere.length, passages, lines, failures, elsewhere, advice };
}

/* ---------- the panel ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function drawMarks() {
  for (const el of document.querySelectorAll('#rdPages .rdpage')) {
    const pi = +el.dataset.p, sz = S.sizes[pi]; el.querySelectorAll('.rdbox').forEach(b => b.remove());
    S.marks.forEach((m, k) => { if (m.page !== pi) return; const b = document.createElement('div'); b.className = 'rdbox'; b.dataset.k = k; b.style.cssText = `left:${m.x / sz.w * 100}%;top:${m.y / sz.h * 100}%;width:${m.w / sz.w * 100}%;height:${m.h / sz.h * 100}%`; el.appendChild(b); });
  }
  const list = $('#rdList');
  list.innerHTML = S.marks.length ? S.marks.map((m, k) => `<li><span>Page ${m.page + 1}${m.text ? `: “${esc(m.text.slice(0, 60))}”` : ': a box you drew'}</span><button class="btn" data-rm="${k}" aria-label="Remove this box on page ${m.page + 1}">Remove</button></li>`).join('') : '<li class="none">Nothing marked yet. Drag a box over what must go, or find words above and black out every match.</li>';
  $('#rdInfo').textContent = S.marks.length ? `${plural(S.marks.length, 'box', 'boxes')} on ${plural(new Set(S.marks.map(m => m.page)).size, 'page', 'pages')}. Nothing is changed until you press the button; the result is a new file.` : 'The document you have open is not changed: the result is a new file.';
  $('#rdGo').disabled = !S.marks.length || S.busy; $('#rdClear').disabled = !S.marks.length;
}
async function findAll(q, add) {
  q = q.trim(); if (q.length < 2) { $('#rdFindN').textContent = q ? 'Type at least 2 letters.' : ''; return []; }
  const r = await wait(hooks.engine().searchAllPages(S.doc, q)), res = r?.results || [];
  $('#rdFindN').textContent = res.length ? `${plural(res.length, 'match', 'matches')}` : 'Not found in the text of this document.';
  if (add) { for (const h of res) for (const rc of h.rects) { const b = re(rc), m = { page: h.pageIndex, x: b.x - 1.5, y: b.y - 2, w: b.w + 3, h: b.h + 4, text: h.context?.match || q }; if (!S.marks.some(o => o.page === m.page && Math.abs(o.x - m.x) < 1 && Math.abs(o.y - m.y) < 1 && Math.abs(o.w - m.w) < 1)) S.marks.push(m); } drawMarks(); if (res.length) { $('#rdFindN').textContent = `${plural(res.length, 'match', 'matches')} marked.`; document.querySelector(`#rdPages .rdpage[data-p="${res[0].pageIndex}"]`)?.scrollIntoView({ block: 'nearest' }); } }
  return res;
}
export async function openRedact(id) {
  if (S) return; const doc = hooks.docOf(id); if (!doc) return;
  S = { id, name: hooks.nameOf(id), doc, marks: [], sizes: doc.pages.map(shown), urls: [], busy: false, result: null };
  $('#rdTitle').textContent = `Black out parts of “${S.name}”`; $('#redact').hidden = false; showReport(null); $('#rdFind').value = ''; $('#rdFindN').textContent = '';
  $('#rdPages').innerHTML = doc.pages.map(p => `<div class="rdpage" data-p="${p.index}" style="aspect-ratio:${S.sizes[p.index].w}/${S.sizes[p.index].h}"><img alt="Page ${p.index + 1}" draggable="false"><span class="n">Page ${p.index + 1}</span></div>`).join('');
  drawMarks();
  for (const p of doc.pages) { if (!S || S.id !== id) return; try { const blob = await wait(hooks.engine().renderPage(doc, p, { scaleFactor: 1.5, rotation: p.rotation, withAnnotations: true, withForms: true })), u = URL.createObjectURL(blob); S.urls.push(u); const im = document.querySelector(`#rdPages .rdpage[data-p="${p.index}"] img`); if (im) im.src = u; } catch (e) {} }
}
export function closeRedact() { if (!S) return; for (const u of S.urls) URL.revokeObjectURL(u); S = null; $('#redact').hidden = true; $('#rdPages').textContent = ''; }
function showReport(r) {
  const box = $('#rdReport'); box.hidden = !r; $('#rdWork').hidden = !!r; $('#rdGo').hidden = !!r; if (!r) return;
  const n = S.marks.length, pics = r.pictures.length ? `<p class="warn">${r.pictures.map(p => `Page ${p.page} became a picture, because ${esc(p.why)}: its words can no longer be selected or searched.`).join(' ')}</p>` : '';
  const cut = [r.cut.infoCut ? `${plural(r.cut.infoCut, 'entry', 'entries')} in the document's information (title, author, subject, keywords)` : '', r.cut.xmpCut ? 'the embedded description of the document' : '', r.cut.marksCut ? plural(r.cut.marksCut, 'bookmark title', 'bookmark titles') : '', r.cut.removedAnnots ? `${plural(r.cut.removedAnnots, 'note, link or form field', 'notes, links or form fields')} under the boxes` : ''].filter(Boolean);
  box.innerHTML = (r.ok
    ? `<h3 class="pass">Checked: none of the ${plural(n, 'blacked-out passage', 'blacked-out passages')} can be found in the new file.</h3>`
    : `<h3 class="fail">Not safe to call this redacted: something you blacked out can still be found.</h3><ul class="bad">${[...r.elsewhere.map(e => `“${esc(e.passage)}” is also on page ${e.page}, outside your boxes.`), ...r.failures.map(f => f.passage ? `“${esc(f.passage)}” ${esc(f.what || `can still be read on page ${f.page}`)}.` : `Page ${f.page}: ${esc(f.what)}.`)].map(t => `<li>${t}</li>`).join('')}</ul><p>${r.elsewhere.length && !r.failures.length ? 'Black out those places too, then check again. Nothing has been saved.' : 'Nothing has been saved. This file cannot be redacted safely here: the words survive somewhere the Reader could not clean.'}</p>`)
    + `<p>What the check did:</p><ul>${r.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
    + (r.ok && r.advice.length ? `<p class="warn">Worth a look before you send it: ${r.advice.map(w => `“${esc(w)}”`).join(', ')} (${r.advice.length === 1 ? 'a word' : 'words'} from what you blacked out) still ${r.advice.length === 1 ? 'appears' : 'appear'} somewhere else in the file, for example in other text or in a link's address. If that also has to go, go back and black it out too.</p>` : '')
    + (cut.length ? `<p>Also removed because they held a blacked-out passage: ${cut.join('; ')}.</p>` : '') + pics
    + (r.passages.length ? `<p class="quiet">Passages searched for: ${r.passages.map(p => `“${esc(p.slice(0, 40))}”`).join(', ')}.</p>` : '<p class="quiet">The boxes covered no text, so there were no words to search for; the boxes themselves were checked.</p>')
    + `<div class="row">${r.ok ? '<button class="btn primary" id="rdSave">Save the redacted copy…</button>' : r.elsewhere.length && !r.failures.length ? '<button class="btn primary" id="rdMore">Black out those places too and check again</button>' : ''}<button class="btn" id="rdBack">Back to the boxes</button></div>`;
  box.querySelector('h3').tabIndex = -1; box.querySelector('h3').focus();
}
async function go() {
  if (!S || S.busy || !S.marks.length) return; S.busy = true; drawMarks();
  const say = m => { $('#rdInfo').textContent = m; };
  try {
    const bytes = new Uint8Array(await (await hooks.bytesOf(S.id)).arrayBuffer());
    S.result = await redact(bytes, S.marks.map(m => ({ ...m })), hooks.engine(), say);
    if (S) showReport(S.result.report);
  } catch (e) { hooks.toast(e?.plain ? e.message.replace('page tools cannot change', 'the Reader cannot black out parts of') : `Could not black out: ${e?.message || e}`, 12000); }
  finally { if (S) { S.busy = false; drawMarks(); } }
}
export function initRedact(h) {
  hooks = h;
  $('#rdClose').addEventListener('click', () => { if (S && S.marks.length && $('#rdReport').hidden && !confirm('Close without blacking anything out? The boxes you drew will be forgotten.')) return; closeRedact(); });
  $('#rdGo').addEventListener('click', go);
  $('#rdClear').addEventListener('click', () => { S.marks = []; drawMarks(); });
  $('#rdMarkAll').addEventListener('click', () => findAll($('#rdFind').value, true));
  $('#rdFind').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findAll($('#rdFind').value, true); } });
  let ft = 0; $('#rdFind').addEventListener('input', () => { clearTimeout(ft); ft = setTimeout(() => S && findAll($('#rdFind').value, false), 250); });
  $('#rdList').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { S.marks.splice(+b.dataset.rm, 1); drawMarks(); } });
  $('#rdReport').addEventListener('click', async e => {
    if (e.target.id === 'rdBack') showReport(null);
    else if (e.target.id === 'rdMore') { for (const p of new Set(S.result.report.elsewhere.map(x => x.passage))) await findAll(p, true); showReport(null); go(); }
    else if (e.target.id === 'rdSave') {
      try { const got = await saveNew(S.result.bytes, S.name.replace(/\.pdf$/i, '') + ' (redacted).pdf'); if (!got) return; const name = S.name; closeRedact(); hooks.toast(`Saved the redacted copy as “${got.name}”. “${name}” itself is untouched and still holds everything.`, 12000, got.handle ? [['Open the copy', async () => hooks.openFile(await got.handle.getFile(), got.handle)]] : []); }
      catch (err) { hooks.toast(`Could not save: ${err?.message || err}`, 9000); }
    }
  });
  // drag a box on a page (pointer events: mouse, pen or finger)
  let d = null; const pagesEl = $('#rdPages');
  pagesEl.addEventListener('pointerdown', e => {
    const pg = e.target.closest('.rdpage'); if (!pg || e.button || !S) return;
    const box = e.target.closest('.rdbox'); if (box) { S.marks.splice(+box.dataset.k, 1); drawMarks(); return; }
    const r = pg.getBoundingClientRect(); d = { pg, r, x0: e.clientX, y0: e.clientY, ghost: document.createElement('div') }; d.ghost.className = 'rdbox ghost'; pg.appendChild(d.ghost); e.preventDefault();
  });
  addEventListener('pointermove', e => { if (!d) return; const x = Math.max(d.r.left, Math.min(d.r.right, e.clientX)), y = Math.max(d.r.top, Math.min(d.r.bottom, e.clientY)); d.box = { l: Math.min(d.x0, x) - d.r.left, t: Math.min(d.y0, y) - d.r.top, w: Math.abs(x - d.x0), h: Math.abs(y - d.y0) }; d.ghost.style.cssText = `left:${d.box.l}px;top:${d.box.t}px;width:${d.box.w}px;height:${d.box.h}px`; });
  addEventListener('pointerup', async () => {
    if (!d) return; const { pg, r, box, ghost } = d; d = null; ghost.remove();
    if (!S || !box || box.w < 5 || box.h < 5) return;
    const pi = +pg.dataset.p, sz = S.sizes[pi], k = sz.w / r.width, m = { page: pi, x: box.l * k, y: box.t * k, w: box.w * k, h: box.h * k, text: '' };
    try { m.text = (await wordsUnder(hooks.engine(), S.doc, S.doc.pages[pi], [m]))[0].replace(/\s+/g, ' ').trim(); } catch (e) {}
    S.marks.push(m); drawMarks();
  });
  addEventListener('keydown', e => { if (S && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); $('#rdClose').click(); } });
}
export const redactOpen = () => !!S;
export const lastResult = () => S?.result || null;
