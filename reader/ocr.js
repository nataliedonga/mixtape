/* Reading scanned pages (OCR): make the pictures of pages searchable and copyable.
   WHAT IT MAKES. Always a NEW PDF ("<name> (searchable).pdf"); the document you have open is never changed. Each
   page that was read keeps its picture exactly as it is and gains a layer of invisible text, placed word by word
   over the words in the picture, so that selecting, copying and Find in any PDF reader land in the right places.
   A page that already has real text is left exactly as it is: it never gets a second layer. A picture file (PNG,
   JPEG, WebP) becomes a one-page PDF holding that picture and its text layer.
   NOTHING LEAVES THIS DEVICE. The reading is done by Tesseract (Apache-2.0) compiled to WebAssembly, in a worker,
   from ../vendor/tesseract: the worker script, the recogniser and the English data are all loaded from there, the
   library's own download addresses are never used (workerPath, corePath and langPath are all set), and its own
   cache is switched off. The worker is started from a blob so that it lives under this page's
   Content-Security-Policy, which refuses every connection except to the app's own files.
   HOW A PAGE IS READ. The viewer's engine (PDFium) draws the page as you see it (upright, whatever way it is
   stored; without the notes and marks added on top of it), at about 300 dots per inch (less
   for a very large page, so memory is not exhausted). Tesseract reads that picture and gives each word a box and a
   confidence. The words are written with pdf-lib in text rendering mode 3 (invisible), in Helvetica, each one sized
   and stretched to its box, in the page's own coordinates (a page stored turned sideways is handled).
   THE CHECK. The new file is opened again with the viewer's engine and the text of every page that was read is
   taken out; the report says, page by page, how many words were read, how many of them can be found in the new
   file, and the recogniser's own mean confidence, and flags pages where nothing was read or confidence is low.
   It never says the reading is right: it is machine reading and has to be checked, names and numbers above all. */
import { lib, load, saveNew } from './pages.js';

const $ = s => document.querySelector(s);
const wait = t => (t && typeof t.toPromise === 'function' ? t.toPromise() : new Promise((res, rej) => t.wait(res, e => rej(e && (e.reason || e)))));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
function ranges(nums) { // [1,2,3,5] -> "1-3, 5"
  const out = []; let a = null, b = null;
  for (const n of nums) { if (a == null) a = b = n; else if (n === b + 1) b = n; else { out.push(a === b ? `${a}` : `${a}-${b}`); a = b = n; } }
  if (a != null) out.push(a === b ? `${a}` : `${a}-${b}`);
  return out.join(', ');
}
const TV = new URL('../vendor/tesseract/', import.meta.url).href;
const IMG = /\.(png|jpe?g|webp|tiff?)$/i;
export const isImage = f => IMG.test(f?.name || '') || /^image\/(png|jpeg|webp|tiff)$/.test(f?.type || '');
export const LIMITS = { dpi: 300, maxSide: 4000, maxPixels: 12e6, textMin: 16, cover: 0.5, lowConf: 75 }; // a page with 16 or more letters has real text; a scan is a picture over half the page
let hooks = {}, S = null;

/* ---------- the recogniser: one worker, made when first needed, ended when the panel closes or Cancel is pressed ---------- */
let ENG = null; // { ready: Promise<worker>, worker, log }
function engine() {
  if (ENG) return ENG;
  const e = { worker: null, log: null, dead: false };
  e.ready = (async () => {
    const T = (await import(TV + 'tesseract.esm.min.js')).default;
    const w = await T.createWorker('eng', 1 /* the LSTM recogniser only */, {
      workerPath: TV + 'worker.min.js', corePath: TV + 'core', langPath: TV + 'lang', gzip: true,
      cacheMethod: 'none',   // the library's own copy of the language data in the browser's storage: not wanted, the app keeps its files itself
      workerBlobURL: true,   // started from a blob: the worker then lives under this page's Content-Security-Policy
      logger: m => e.log?.(m), errorHandler: () => {},
    }, { debug_file: '/dev/null' }); // Tesseract's own remarks ("Detected 152 diacritics") would otherwise land in the console as errors

    if (e.dead) { try { await w.terminate(); } catch (err) {} throw stopped(); }
    e.worker = w; return w;
  })();
  e.ready.catch(() => { if (ENG === e) ENG = null; });
  return (ENG = e);
}
export function endEngine() { const e = ENG; ENG = null; if (!e) return; e.dead = true; e.log = null; try { e.worker?.terminate(); } catch (err) {} }
const stopped = () => Object.assign(new Error('stopped'), { stopped: true });
function canceller() { let stop; const p = new Promise((_, rej) => { stop = () => rej(stopped()); }); p.catch(() => {}); return { p, stop }; }

/* Read one picture. -> { words: [{ text, conf, x0, y0, x1, y1, base, h, eol }], conf, ms } in the picture's pixels.
   base is where the line's baseline passes under the middle of the word; h is the tallest word of its line. */
export async function readPicture(blob, { dpi = 0, progress = () => {}, cancel = null } = {}) {
  const e = engine(), t0 = performance.now();
  e.log = m => { if (m.status === 'recognizing text') progress(m.progress, ''); else progress(0, /core|initializ/.test(m.status) ? 'Getting the recogniser ready…' : /language|api/.test(m.status) ? 'Loading the English data…' : ''); };
  const job = (async () => {
    const w = await e.ready;
    await w.setParameters({ tessedit_pageseg_mode: '3', user_defined_dpi: String(Math.round(Math.max(70, Math.min(600, dpi || 300)))) }); // 3: find the columns, tables and blocks of a whole page (the library's own default treats the picture as one block of text)
    return w.recognize(blob, {}, { text: true, blocks: true });
  })();
  const r = await (cancel ? Promise.race([job, cancel.p]) : job); e.log = null;
  const words = [];
  for (const b of r.data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    const ws = (l.words || []).filter(w => (w.text || '').trim()), h = Math.max(0, ...ws.map(w => w.bbox.y1 - w.bbox.y0)), bl = l.baseline;
    ws.forEach((w, k) => {
      const cx = (w.bbox.x0 + w.bbox.x1) / 2; let base = w.bbox.y1;
      if (bl && bl.x1 - bl.x0 > 1) { const y = bl.y0 + (bl.y1 - bl.y0) * (cx - bl.x0) / (bl.x1 - bl.x0); if (y > w.bbox.y0 && y <= w.bbox.y1 + h * 0.3) base = y; }
      words.push({ text: w.text.trim(), conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, base, h, eol: k === ws.length - 1 });
    });
  }
  const conf = words.length ? words.reduce((a, w) => a + w.conf, 0) / words.length : 0;
  return { words, conf, ms: performance.now() - t0 };
}

/* Is there anything on this picture at all? A blank scan is only paper grain, and the recogniser can spend minutes
   on grain. Looked at 1,000 pixels wide: blank when nothing is clearly darker or lighter than the paper. */
function nothingOnIt(pic) {
  const w = Math.min(1000, pic.width), h = Math.max(1, Math.round(pic.height * w / pic.width)), c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(pic, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, hist = new Uint32Array(256); for (let i = 0; i < d.length; i += 4) hist[(d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10 | 0]++;
  let paper = 0, dark = 0, light = 255, n = 0; for (; paper < 255 && (n += hist[paper]) < w * h / 2; paper++);
  for (n = 0; dark < 255 && (n += hist[dark]) < 25; dark++); for (n = 0; light > 0 && (n += hist[light]) < 25; light--);
  return paper - dark < 18 && light - paper < 18;
}
const BLANK = { words: [], conf: 0, ms: 0, blank: true };

/* ---------- which pages are scans ---------- */
const latin1 = new TextDecoder('latin1');
const mul = (A, B) => [A[0] * B[0] + A[1] * B[2], A[0] * B[1] + A[1] * B[3], A[2] * B[0] + A[3] * B[2], A[2] * B[1] + A[3] * B[3], A[4] * B[0] + A[5] * B[2] + B[4], A[4] * B[1] + A[5] * B[3] + B[5]];
/* How much of the page is covered by pictures (0 to 1): the page's drawing instructions are followed just far
   enough to know where each picture is put (q, Q, cm, Do), also inside the groups (forms) a page may be built of. */
export function pictureCover(P, pg) {
  const ctx = pg.doc.context, N = P.PDFName.of, val = v => (v instanceof P.PDFRef ? ctx.lookup(v) : v), box = pg.getCropBox(); let area = 0;
  const bytes = s => { try { return s instanceof P.PDFRawStream ? P.decodePDFRawStream(s).decode() : s.getContents(); } catch (e) { return null; } };
  const walk = (streams, res, m0, depth) => {
    const xo = val(res instanceof P.PDFDict ? res.get(N('XObject')) : null); if (!(xo instanceof P.PDFDict)) return;
    let src = ''; for (const s of streams) { const b = bytes(s); if (b && b.length < 30e6) src += latin1.decode(b) + '\n'; }
    src = src.replace(/\((?:\\[\s\S]|[^\\()])*\)/g, ' ');
    const re = /\/([^\s/[\]<>(){}%]+)|(-?(?:\d+\.?\d*|\.\d+))|([A-Za-z'"*]+)/g; let stack = [], m = m0, nums = [], name = null, t;
    while ((t = re.exec(src))) {
      if (t[1] != null) name = t[1]; else if (t[2] != null) nums.push(+t[2]);
      else {
        const op = t[3];
        if (op === 'q') stack.push(m); else if (op === 'Q') m = stack.pop() || m;
        else if (op === 'cm' && nums.length >= 6) m = mul(nums.slice(-6), m);
        else if (op === 'Do' && name) {
          const x = val(xo.get(N(name))), d = x instanceof P.PDFStream ? x.dict : null, sub = d ? val(d.get(N('Subtype'))) : null;
          if (sub === N('Image')) {
            const xs = [m[4], m[0] + m[4], m[2] + m[4], m[0] + m[2] + m[4]], ys = [m[5], m[1] + m[5], m[3] + m[5], m[1] + m[3] + m[5]];
            const w = Math.min(box.x + box.width, Math.max(...xs)) - Math.max(box.x, Math.min(...xs)), h = Math.min(box.y + box.height, Math.max(...ys)) - Math.max(box.y, Math.min(...ys));
            if (w > 0 && h > 0) area += w * h;
          } else if (sub === N('Form') && depth < 4) {
            const mx = val(d.get(N('Matrix'))), fm = mx instanceof P.PDFArray && mx.size() === 6 ? mx.asArray().map(v => val(v)?.asNumber?.() ?? 0) : [1, 0, 0, 1, 0, 0];
            walk([x], val(d.get(N('Resources'))) || res, mul(fm, m), depth + 1);
          }
        }
        nums = []; name = null;
      }
    }
  };
  try {
    const c = val(pg.node.get(N('Contents'))), streams = (c instanceof P.PDFArray ? c.asArray().map(val) : [c]).filter(s => s instanceof P.PDFStream);
    walk(streams, pg.node.Resources(), [1, 0, 0, 1, 0, 0], 0);
  } catch (e) {}
  return Math.min(1, area / Math.max(1, box.width * box.height));
}
/* -> [{ index, letters, cover, hasText, scan }] for every page; `each` is told how far it has got */
export async function lookAtPages(bytes, engDoc, eng, each = () => {}) {
  const P = await lib(), pd = await load(bytes), pages = pd.getPages(), out = [];
  for (const p of engDoc.pages) {
    let letters = 0; try { letters = (await wait(eng.extractText(engDoc, [p.index]))).replace(/\s+/g, '').length; } catch (e) {}
    const hasText = letters >= LIMITS.textMin, cover = hasText || !pages[p.index] ? 0 : pictureCover(P, pages[p.index]);
    out.push({ index: p.index, letters, cover, hasText, scan: !hasText && cover >= LIMITS.cover }); each(out.length, engDoc.pages.length);
  }
  return out;
}

/* ---------- writing the invisible text ---------- */
const LIG = { 'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl', '‐': '-', '‑': '-', '−': '-', '′': "'", '″': '"' };
function writer(font) { // letters Helvetica cannot write (anything outside Western European) are left out and counted
  const can = new Map(); let lost = 0;
  const ok = ch => { let v = can.get(ch); if (v == null) { try { font.encodeText(ch); v = true; } catch (e) { v = false; } can.set(ch, v); } return v; };
  return { clean(t) { let out = ''; for (const ch of t.replace(/[ﬀ-ﬄ‐‑−′″]/g, c => LIG[c] || c)) { if (ok(ch)) out += ch; else lost++; } return out; }, lost: () => lost };
}
/* Put the words on a page. k: points per pixel of the picture that was read; the picture is the page as displayed
   (W by H points, turned by `turn` degrees from how it is stored). */
function addLayer(P, pg, font, wr, words, k, W, H, turn, box, wrap) {
  if (!words.length) return 0;
  if (wrap) { // whatever the page's own drawing leaves switched on (a scale, a clip) must not reach the text
    const ctx = pg.doc.context; pg.node.normalize();
    pg.node.wrapContentStreams(ctx.register(ctx.contentStream([P.pushGraphicsState()])), ctx.register(ctx.contentStream([P.popGraphicsState()])));
  }
  const M = turn === 90 ? [0, 1, -1, 0, box.x + H, box.y] : turn === 180 ? [-1, 0, 0, -1, box.x + W, box.y + H] : turn === 270 ? [0, -1, 1, 0, box.x, box.y + W] : [1, 0, 0, 1, box.x, box.y];
  const key = pg.node.newFontDictionary(font.name, font.ref), ops = [P.pushGraphicsState(), P.concatTransformationMatrix(...M), P.beginText(), P.setTextRenderingMode(P.TextRenderingMode.Invisible)]; let n = 0;
  for (const w of words) {
    const t = wr.clean(w.text); if (!t) continue;
    const size = Math.max(2, (w.h || w.y1 - w.y0) * k / 0.9), natural = font.widthOfTextAtSize(t, size), want = (w.x1 - w.x0) * k; if (!(natural > 0) || !(want > 0)) continue;
    ops.push(P.setFontAndSize(key, size), P.setCharacterSqueeze(Math.max(1, Math.min(2000, want / natural * 100))), P.setTextMatrix(1, 0, 0, 1, w.x0 * k, H - w.base * k), P.showText(font.encodeText(w.eol ? t : t + ' '))); n++;
  }
  ops.push(P.endText(), P.popGraphicsState()); pg.pushOperators(...ops); return n;
}

/* ---------- the check: read the new file back with the viewer's own engine ---------- */
const tokens = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean);
async function readBack(bytes, results, eng) { // results: [{ page (index in the new file), words }] gains .found
  const doc = await wait(eng.openDocumentBuffer({ id: 'ocr-check-' + Date.now(), content: bytes.slice().buffer }));
  try {
    for (const r of results) {
      const text = await wait(eng.extractText(doc, [r.page])), have = new Map(), flat = text.toLowerCase().replace(/\s+/g, ''); for (const t of tokens(text)) have.set(t, (have.get(t) || 0) + 1);
      let found = 0; for (const w of r.written) { const t = w.toLowerCase().replace(/\s+/g, ''), n = have.get(t) || 0; if (n) { have.set(t, n - 1); found++; } else if (flat.includes(t)) found++; }
      r.found = found;
    }
  } finally { try { await wait(eng.closeDocument(doc)); } catch (e) {} }
}
function pageResult(page, label, got, wr) {
  const written = got.words.map(w => wr.clean(w.text)).filter(Boolean);
  const unsure = got.words.filter(w => w.conf < 60).sort((a, b) => a.conf - b.conf).slice(0, 8).map(w => ({ text: w.text, conf: Math.round(w.conf) }));
  return { page, label, words: got.words.length, written, conf: got.conf, secs: got.ms / 1000, unsure, boxes: got.words };
}

/* ---------- the whole job for a PDF. pages: indexes to read. -> { bytes, results, skipped } ---------- */
export async function makeSearchable(bytes, pages, eng, { say = () => {}, progress = () => {}, cancel = null } = {}) {
  const P = await lib(), pd = await load(bytes); // refuses protected PDFs before any work
  const doc = await wait(eng.openDocumentBuffer({ id: 'ocr-' + Date.now(), content: bytes.slice().buffer })), got = new Map(), skipped = [];
  try {
    let k = 0;
    for (const pi of pages) {
      const page = doc.pages[pi]; k++; if (!page) continue;
      if ((await wait(eng.extractText(doc, [pi]))).replace(/\s+/g, '').length >= LIMITS.textMin) { skipped.push(pi + 1); continue; } // real text: left exactly as it is
      const label = `Reading page ${pi + 1} (${k} of ${pages.length})…`; say(label); progress(k - 1, pages.length, 0);
      /* A document the engine opens itself (as here) gives each page's size as it is displayed, and draws it upright
         with rotation 0, whatever way the page is stored. (The viewer's own copy of a document is different: size as
         stored, and rotation = page.rotation to draw it upright. Tested with pages stored at 90, 180 and 270.) */
      const size = { w: page.size.width, h: page.size.height }, scale = Math.min(LIMITS.dpi / 72, LIMITS.maxSide / Math.max(size.w, size.h), Math.sqrt(LIMITS.maxPixels / (size.w * size.h)));
      const blob = await wait(eng.renderPage(doc, page, { scaleFactor: scale, rotation: 0, withAnnotations: false })), bmp = await createImageBitmap(blob), px = bmp.width, empty = nothingOnIt(bmp); bmp.close?.();
      const r = empty ? BLANK : await readPicture(blob, { dpi: px / size.w * 72, cancel, progress: (f, note) => { progress(k - 1, pages.length, f); say(note || label); } });
      got.set(pi, { ...r, k: size.w / px, size });
    }
  } finally { try { await wait(eng.closeDocument(doc)); } catch (e) {} }
  say('Writing the new file…');
  const font = await pd.embedFont(P.StandardFonts.Helvetica), wr = writer(font), pgs = pd.getPages(), results = [];
  for (const [pi, r] of got) {
    const pg = pgs[pi], turn = ((pg.getRotation().angle % 360) + 360) % 360;
    addLayer(P, pg, font, wr, r.words, r.k, r.size.w, r.size.h, turn, pg.getCropBox(), true);
    results.push(pageResult(pi, `Page ${pi + 1}`, r, wr));
  }
  const out = await pd.save({ updateFieldAppearances: false });
  say('Checking the new file…'); await readBack(out, results, eng);
  return { bytes: out, results, skipped, lost: wr.lost() };
}

/* ---------- the whole job for a picture file: a one-page PDF with the picture and its text ---------- */
function exifTurn(b) { // how a JPEG says it should be turned (1 = as it is)
  if (b[0] !== 0xFF || b[1] !== 0xD8) return 1; let o = 2;
  while (o + 4 < b.length && b[o] === 0xFF) {
    const m = b[o + 1], len = (b[o + 2] << 8) | b[o + 3];
    if (m === 0xE1 && b[o + 4] === 0x45 && b[o + 5] === 0x78 && b[o + 6] === 0x69 && b[o + 7] === 0x66) {
      const t = o + 10, le = b[t] === 0x49, u16 = p => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]), u32 = p => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0 : ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0);
      const ifd = t + u32(t + 4), n = u16(ifd); for (let i = 0; i < n && ifd + 14 + i * 12 <= b.length; i++) { const e = ifd + 2 + i * 12; if (u16(e) === 0x0112) return u16(e + 8); } return 1;
    }
    if (m === 0xDA) break; o += 2 + len;
  }
  return 1;
}
const pngOf = c => new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('the browser could not make a picture of it'))), 'image/png'));
export async function pictureToPdf(file, eng, { say = () => {}, progress = () => {}, cancel = null } = {}) {
  const P = await lib(), raw = new Uint8Array(await file.arrayBuffer());
  let bmp; try { bmp = await createImageBitmap(new Blob([raw])); } catch (e) { const x = new Error(/\.tiff?$/i.test(file.name) ? 'This browser cannot open TIFF pictures. Save it as PNG or JPEG (any picture program can) and open that.' : 'The browser could not open this picture. It may be damaged, or not really a picture.'); x.plain = true; throw x; }
  const bw = bmp.width, bh = bmp.height, f = Math.min(1, LIMITS.maxSide / Math.max(bw, bh), Math.sqrt(LIMITS.maxPixels / (bw * bh)));
  const draw = s => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bw * s)); c.height = Math.max(1, Math.round(bh * s)); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return c; };
  const small = draw(f), s = Math.min(0.75, 842 / Math.max(bw, bh)), W = bw * s, H = bh * s; // on the page: its own size at 96 to the inch, or shrunk to fit the long side of A4
  say('Reading the picture…'); progress(0, 1, 0);
  const r = nothingOnIt(small) ? BLANK : await readPicture(await pngOf(small), { dpi: small.width / W * 72, cancel, progress: (p, note) => { progress(0, 1, p); say(note || 'Reading the picture…'); } });
  say('Writing the new file…');
  const pd = await P.PDFDocument.create(), pg = pd.addPage([W, H]), isJpg = raw[0] === 0xFF && raw[1] === 0xD8, isPng = raw[0] === 0x89 && raw[1] === 0x50, turn = isJpg ? exifTurn(raw) : 1;
  let im = null, how = 'as it is';
  try { if (isJpg && [1, 3, 6, 8].includes(turn)) im = await pd.embedJpg(raw); else if (isPng) im = await pd.embedPng(raw); } catch (e) { im = null; }
  if (im && Math.abs((turn === 6 || turn === 8 ? im.height : im.width) - bw) > 1) im = null; // not the picture the browser showed: take the browser's
  if (!im) { im = await pd.embedPng(new Uint8Array(await (await pngOf(draw(1))).arrayBuffer())); how = 'its pixels, kept without loss'; }
  if (turn === 6) pg.drawImage(im, { x: 0, y: H, width: H, height: W, rotate: P.degrees(-90) });
  else if (turn === 8) pg.drawImage(im, { x: W, y: 0, width: H, height: W, rotate: P.degrees(90) });
  else if (turn === 3) pg.drawImage(im, { x: W, y: H, width: W, height: H, rotate: P.degrees(180) });
  else pg.drawImage(im, { x: 0, y: 0, width: W, height: H });
  bmp.close?.();
  const font = await pd.embedFont(P.StandardFonts.Helvetica), wr = writer(font);
  addLayer(P, pg, font, wr, r.words, W / small.width, W, H, 0, { x: 0, y: 0 }, false);
  const results = [pageResult(0, 'The picture', r, wr)], out = await pd.save();
  say('Checking the new file…'); await readBack(out, results, eng);
  return { bytes: out, results, skipped: [], lost: wr.lost(), how };
}

/* ---------- the panel ---------- */
const show = which => { for (const id of ['ocSetup', 'ocRun', 'ocReport']) $('#' + id).hidden = id !== which; $('#ocGo').hidden = which !== 'ocSetup'; $('#ocCancel').hidden = which !== 'ocRun'; $('#ocClose').hidden = which === 'ocRun'; };
function parseRange(v, n) { // -> page indexes, or a sentence saying what is wrong
  const out = new Set();
  for (const part of v.split(/[,;]+/).map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(part); if (!m) return `“${part}” is not a page or a range of pages. Write them like 1-3, 5.`;
    const a = +m[1], b = +(m[2] || m[1]); if (a < 1 || b > n || a > b) return `“${part}” does not fit: this document has pages 1 to ${n}.`;
    for (let i = a; i <= b; i++) out.add(i - 1);
  }
  return out.size ? [...out].sort((a, b) => a - b) : 'Type the pages to read, for example 1-3, 5.';
}
function chosen() { // -> { pages: [indexes], say } for the choice that is ticked
  const n = S.pages.length, which = document.querySelector('#ocWhich input[name="ocWhich"]:checked')?.value || 'scans', noText = S.pages.filter(p => !p.hasText).map(p => p.index);
  if (which === 'scans') return { pages: S.pages.filter(p => p.scan).map(p => p.index), say: '' };
  if (which === 'all') return { pages: noText, say: '' };
  const r = parseRange($('#ocRange').value, n); if (typeof r === 'string') return { pages: [], say: r };
  const keep = r.filter(i => !S.pages[i].hasText), left = r.filter(i => S.pages[i].hasText).map(i => i + 1);
  return { pages: keep, left, say: left.length ? `${left.length === 1 ? 'Page' : 'Pages'} ${ranges(left)} already ${left.length === 1 ? 'has' : 'have'} text and will be left exactly as ${left.length === 1 ? 'it is' : 'they are'}.${keep.length ? '' : ' There is nothing to read in those pages.'}` : '' };
}
function drawSetup() {
  if (!S) return;
  if (S.kind === 'image') { $('#ocGo').disabled = S.busy; $('#ocGo').textContent = 'Read this picture'; $('#ocInfo').textContent = 'The picture file is not changed: the result is a new PDF.'; return; }
  const c = S.pages ? chosen() : { pages: [], say: '' };
  $('#ocSay').textContent = c.say; $('#ocGo').disabled = S.busy || !c.pages.length;
  $('#ocGo').textContent = c.pages.length ? `Read ${plural(c.pages.length, 'page', 'pages')}` : 'Read the pages';
  $('#ocInfo').textContent = 'The document you have open is not changed: the result is a new file.';
}
function drawFound() {
  const n = S.pages.length, scans = S.pages.filter(p => p.scan).map(p => p.index + 1), bare = S.pages.filter(p => !p.hasText).map(p => p.index + 1), texty = n - bare.length;
  $('#ocFound').textContent = !bare.length ? `Every page of this document already has text you can select and search, so there is nothing to read.`
    : scans.length ? `${scans.length === n ? (n === 1 ? 'This page looks' : `All ${n} pages look`) : `${plural(scans.length, 'page looks', 'pages look')}`} like ${scans.length === 1 ? 'a scan' : 'scans'}: a picture of a page, with no text to select or search.${texty ? ` ${plural(texty, 'page already has', 'pages already have')} text and will be left exactly as ${texty === 1 ? 'it is' : 'they are'}.` : ''}`
      : `No page looks like a scan, but ${plural(bare.length, 'page has', 'pages have')} no text. You can still have ${bare.length === 1 ? 'it' : 'them'} read.`;
  const set = (v, on, text) => { const i = document.querySelector(`#ocWhich input[value="${v}"]`); i.disabled = !on; i.closest('label').classList.toggle('off', !on); if (text != null) $(v === 'scans' ? '#ocScansLbl' : '#ocAllLbl').textContent = text; return i; };
  const a = set('scans', scans.length > 0, scans.length ? `The ${plural(scans.length, 'page', 'pages')} with no text that ${scans.length === 1 ? 'looks like a scan' : 'look like scans'} (${scans.length === 1 ? 'page' : 'pages'} ${ranges(scans)})` : 'The pages that look like scans (none found)');
  const b = set('all', bare.length > 0, bare.length ? `Every page with no text (${bare.length === 1 ? 'page' : `${bare.length} pages:`} ${ranges(bare)})` : 'Every page with no text (there are none)');
  set('range', bare.length > 0); $('#ocRange').disabled = !bare.length;
  (scans.length ? a : b).checked = true;
  $('#ocChips').innerHTML = S.pages.map(p => `<li class="${p.scan ? 'scan' : p.hasText ? 'text' : 'bare'}"><b>${p.index + 1}</b> ${p.scan ? 'scan, no text' : p.hasText ? 'has text' : 'no text'}</li>`).join('');
  drawSetup();
}
export async function openOcr(id) {
  if (S) return; const doc = hooks.docOf(id); if (!doc) return hooks.toast('This reads the pages of the PDF in front, and that one is not open yet. If it is waiting for its password, enter that first.', 7000);
  S = { kind: 'pdf', id, name: hooks.nameOf(id), doc, pages: null, bytes: null, busy: false, run: null, result: null };
  const me = S;
  $('#ocTitle').textContent = `Read the scanned pages of “${S.name}”`; $('#ocr').hidden = false; $('#ocPdf').hidden = false; $('#ocPic').hidden = true; show('ocSetup');
  $('#ocWhat').textContent = WHAT.pdf; $('#ocFound').textContent = 'Looking at the pages…'; $('#ocChips').textContent = ''; $('#ocWhich').hidden = true; $('#ocRange').value = ''; drawSetup(); $('#ocTitle').focus();
  try {
    S.bytes = new Uint8Array(await (await hooks.bytesOf(id)).arrayBuffer());
    const pages = await lookAtPages(S.bytes, doc, hooks.engine(), (k, n) => { if (S === me && n > 20) $('#ocFound').textContent = `Looking at the pages… ${k} of ${n}`; });
    if (S !== me) return; S.pages = pages; $('#ocWhich').hidden = false; drawFound();
  } catch (e) { if (S !== me) return; const m = e?.plain ? e.message.replace('page tools cannot change', 'the Reader cannot add a text layer to') : `The pages could not be looked at: ${e?.message || e}`; closeOcr(); hooks.toast(m, 12000); }
}
const WHAT = { pdf: 'You get a new PDF that looks the same: every page keeps its picture, and the words are laid over it as invisible text, so you can select, copy and search them. Pages that already have text are left exactly as they are. The reading is done on this device; nothing is uploaded. It is machine reading: it makes mistakes, and the result says how sure it was page by page.',
  image: 'You get a new one-page PDF holding this picture, with its words laid over it as invisible text, so you can select, copy and search them. The picture file itself is not changed. The reading is done on this device; nothing is uploaded. It is machine reading: it makes mistakes, and the result says how sure it was.' };
export async function openImage(file) {
  closeOcr();
  try { (await createImageBitmap(file)).close?.(); } // can this browser show it at all?
  catch (e) { return hooks.toast(/\.tiff?$/i.test(file.name) || file.type === 'image/tiff' ? `“${file.name}” is a TIFF picture, which this browser cannot open. Save it as PNG or JPEG (any picture program can) and open that.` : `“${file.name}” could not be opened as a picture. It may be damaged, or not really a picture.`, 10000); }
  $('#ocWhat').textContent = WHAT.image;
  S = { kind: 'image', file, name: file.name, busy: false, run: null, result: null, url: URL.createObjectURL(file) };
  $('#ocTitle').textContent = `Read the words in “${S.name}”`; $('#ocr').hidden = false; $('#ocPdf').hidden = true; $('#ocPic').hidden = false; show('ocSetup');
  const im = $('#ocPicImg'); im.src = S.url; im.alt = `The picture ${S.name}`; drawSetup(); $('#ocGo').focus();
}
export function closeOcr() {
  if (!S) return; const s = S; S = null; s.run?.stop(); endEngine(); if (s.url) URL.revokeObjectURL(s.url);
  $('#ocr').hidden = true; $('#ocReport').textContent = ''; $('#ocChips').textContent = ''; $('#ocPicImg').removeAttribute('src');
}
function setBar(done, of, part) { const f = Math.max(0, Math.min(1, (done + part) / Math.max(1, of))); $('#ocBar').value = f; $('#ocPct').textContent = `${Math.round(f * 100)}%`; }
async function go() {
  if (!S || S.busy) return; const me = S, pick = S.kind === 'pdf' ? chosen() : { pages: [0] }, pages = pick.pages; if (!pages.length) return;
  S.busy = true; S.run = canceller(); show('ocRun'); setBar(0, 1, 0); $('#ocStep').textContent = 'Getting the recogniser ready (about 7 MB, from this app’s own files)…'; $('#ocCancel').disabled = false; $('#ocCancel').focus();
  const t0 = performance.now(), opt = { say: m => { if (S === me) $('#ocStep').textContent = m; }, progress: (d, of, part) => { if (S === me) setBar(d, of, part); }, cancel: S.run };
  try {
    const r = S.kind === 'pdf' ? await makeSearchable(S.bytes, pages, hooks.engine(), opt) : await pictureToPdf(S.file, hooks.engine(), opt);
    if (S !== me) return; r.secs = (performance.now() - t0) / 1000; r.skipped = [...new Set([...(pick.left || []), ...r.skipped])].sort((a, b) => a - b); S.result = r; showReport(r);
  } catch (e) {
    if (S !== me) return; show('ocSetup');
    if (e?.stopped) { endEngine(); hooks.toast('Stopped. Nothing was read into a file and nothing was saved.', 6000); }
    else hooks.toast(e?.plain ? e.message.replace('page tools cannot change', 'the Reader cannot add a text layer to') : `The pages could not be read: ${e?.message || e}`, 12000);
  } finally { if (S === me) { S.busy = false; S.run = null; if ($('#ocReport').hidden) drawSetup(); } }
}
function showReport(r) {
  const box = $('#ocReport'), read = r.results, words = read.reduce((a, p) => a + p.words, 0), flagged = [];
  const rows = read.map(p => {
    const missing = p.written.length - p.found; let cls = '', line;
    if (!p.words) { cls = 'warn'; line = `${esc(p.label)}: nothing could be read; it may be blank or too faint.`; flagged.push(p.label); }
    else {
      const low = p.conf < LIMITS.lowConf; if (low || missing > 0) { cls = 'warn'; flagged.push(p.label); }
      line = `${esc(p.label)}: ${plural(p.words, 'word', 'words')} read, the recogniser’s confidence ${Math.round(p.conf)}%${low ? ' (low: check this page closely)' : ''}. ${missing > 0 ? `${plural(missing, 'word', 'words')} could not be found again in the new file.` : `${p.words === 1 ? 'It was' : p.words === 2 ? 'Both were' : `All ${p.words.toLocaleString()} were`} found again in the new file.`}`
        + (p.unsure.length ? ` <span class="quiet">Least sure of: ${p.unsure.map(w => `“${esc(w.text.slice(0, 24))}” ${w.conf}%`).join(', ')}.</span>` : '');
    }
    return `<li class="${cls}">${line}</li>`;
  }).join('');
  box.innerHTML = `<h3 class="plain" tabindex="-1">${words ? `A searchable copy is ready: ${plural(words, 'word', 'words')} read ${S.kind === 'image' ? 'in the picture' : `on ${plural(read.filter(p => p.words).length, 'page', 'pages')}`}.` : 'Nothing could be read.'}</h3>`
    + `<p class="warn">This is machine reading and it makes mistakes, most of all with names, numbers, small or faint print, tables and handwriting. Check anything that matters against the page itself before you rely on it or quote it.</p>`
    + `<ul class="ocpages">${rows}</ul>`
    + (r.skipped.length ? `<p>${r.skipped.length === 1 ? 'Page' : 'Pages'} ${ranges(r.skipped)} already had text and ${r.skipped.length === 1 ? 'was' : 'were'} left exactly as ${r.skipped.length === 1 ? 'it was' : 'they were'}.</p>` : '')
    + (r.lost ? `<p class="warn">${plural(r.lost, 'character', 'characters')} outside Western European letters could not be written into the text layer and ${r.lost === 1 ? 'was' : 'were'} left out.</p>` : '')
    + `<p>What was done: ${S.kind === 'image' ? `the picture was put on one page (${esc(r.how)})` : 'each page that was read keeps its picture exactly as it was'}, with the words laid over it as invisible text you can select, copy and search. Then the new file was opened again and its text read back, which is what the counts above say. The confidence is the recogniser’s own estimate, not a measure of how many words are right. It took ${r.secs < 10 ? r.secs.toFixed(1) : Math.round(r.secs)} seconds, all on this device.</p>`
    + `<div class="row">${words ? '<button class="btn primary" id="ocSave">Save the searchable copy…</button>' : ''}<button class="btn" id="ocBack">Back</button></div>`;
  show('ocReport'); box.querySelector('h3').focus();
  $('#ocInfo').textContent = flagged.length ? `Look closely at: ${flagged.join(', ').toLowerCase()}.` : 'Not saved yet.';
}
export function initOcr(h) {
  hooks = h;
  $('#ocClose').addEventListener('click', closeOcr);
  $('#ocCancel').addEventListener('click', () => { $('#ocCancel').disabled = true; S?.run?.stop(); endEngine(); });
  $('#ocGo').addEventListener('click', go);
  $('#ocWhich').addEventListener('change', drawSetup);
  $('#ocRange').addEventListener('input', () => { document.querySelector('#ocWhich input[value="range"]').checked = true; drawSetup(); });
  $('#ocRange').addEventListener('keydown', e => { if (e.key === 'Enter' && !$('#ocGo').disabled) { e.preventDefault(); go(); } });
  $('#ocReport').addEventListener('click', async e => {
    if (e.target.id === 'ocBack') { show('ocSetup'); drawSetup(); $('#ocGo').focus(); }
    else if (e.target.id === 'ocSave') {
      try {
        const got = await saveNew(S.result.bytes, S.name.replace(/\.[a-z0-9]{2,5}$/i, '') + ' (searchable).pdf'); if (!got) return; const name = S.name; closeOcr();
        hooks.toast(`Saved the searchable copy as “${got.name}”. “${name}” itself is untouched.`, 12000, got.handle ? [['Open the copy', async () => hooks.openFile(await got.handle.getFile(), got.handle)]] : []);
      } catch (err) { hooks.toast(`Could not save: ${err?.message || err}`, 9000); }
    }
  });
  addEventListener('keydown', e => { if (S && e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); if (S.busy) $('#ocCancel').click(); else closeOcr(); } });
}
export const ocrOpen = () => !!S;
export const lastResult = () => S?.result || null;
