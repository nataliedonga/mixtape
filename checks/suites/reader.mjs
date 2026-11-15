// Reader: a PDF opens and its page count shows; a highlight is added; the saved copy opens again with the highlight.
// Done twice: on the checks' own two-page PDF with a real mouse (Annotate ▸ Highlight, drag across the line), and on
// _test/ebook.pdf when it is there (a real-world file; highlighted through the viewer, since where its text sits is unknown).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETURNING } from '../lib/inpage.mjs';

export const needsBrowser = true;
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
// "Save a copy…" would open the system's save window, which a check cannot answer and which could write anywhere. With
// the picker switched off the Reader falls back to a plain download, and the check reads that inside the page.
const PRELOAD = RETURNING + `\nwindow.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined;`;
const ROOT = `document.querySelector('#viewer').firstElementChild.shadowRoot`;
const ANN = `__reader.cap('annotation').forDocument(__reader.activeId())`;
const HIGHLIGHT = 9; // the PDF annotation subtype number the viewer uses for a highlight
const highlights = `Object.values(${ANN}.getState().byUid).filter(a => a.object.type === ${HIGHLIGHT}).map(a => ({ page: a.object.pageIndex, x: Math.round(a.object.rect.origin.x), y: Math.round(a.object.rect.origin.y), w: Math.round(a.object.rect.size.width), text: (a.object.custom && a.object.custom.text) || '', state: a.commitState }))`;
// the page count as the viewer shows it: the number after the page box, between "Previous Page" and "Next Page"
const SHOWN_PAGES = `(() => { const out = []; const walk = n => { for (const c of n.childNodes) { if (c.nodeType === 3) { const s = c.textContent.trim(); if (s && c.parentElement.tagName !== 'STYLE') out.push(s); } else if (c.nodeType === 1 && c.tagName !== 'STYLE') { if (c.tagName === 'INPUT') out.push('[' + c.value + ']'); walk(c); } } }; walk(${ROOT});
  const i = out.indexOf('Previous Page'); const m = i < 0 ? null : out.slice(i + 1, i + 4); return m && /^\\[\\d+\\]$/.test(m[0]) && /^\\d+$/.test(m[1]) ? { page: +m[0].slice(1, -1), of: +m[1] } : null; })()`;

async function roundTrip(t, page, file, label, addHighlight) {
  const name = path.basename(file), before = await page.eval(`__reader.docs.size`);
  await page.setFiles('#fileIn', [file]);
  await page.waitFor(`__reader.docs.size === ${before + 1} && __reader.dm.getActiveDocument() && __reader.dm.getActiveDocument().pageCount > 0`, 30000, `${name} to open`);
  const shown = await page.waitFor(SHOWN_PAGES, 10000, 'the page count to show').catch(() => null);
  const pages = await page.eval(`__reader.dm.getActiveDocument().pageCount`), state = await page.eval(`document.querySelector('#state').textContent`);
  t.check(`${label}: opens, page count shown`, 'the document opens, the header names it, and the viewer shows “page 1 of N” with N the real page count', state.includes(name) && shown && shown.page === 1 && shown.of === pages && pages > 0, { header: state, shown, pages });

  await addHighlight(pages);
  await page.waitFor(`${highlights}.length === 1 && ${highlights}[0].state === 'synced'`, 10000, 'the highlight to be made').catch(() => {});
  const made = await page.eval(highlights), dirty = await page.eval(`document.querySelector('#state').textContent`);
  t.check(`${label}: add a highlight`, 'one highlight on page 1, and the header says the change is not in a file yet', made.length === 1 && made[0].page === 0 && /not in a file yet/.test(dirty), { highlights: made, header: dirty });

  await page.eval(`(window.__chk.dl.length = 0, true)`);
  await page.click('#saveAsBtn');
  await page.waitFor(`window.__chk.dl.length === 1`, 20000, 'the saved copy');
  const copy = await page.eval(`(async () => { const d = window.__chk.dl[0], s = d.blob ? await d.blob.text() : ''; return { name: d.name, bytes: d.blob ? d.blob.size : 0, pdf: s.startsWith('%PDF-'), highlightInFile: /\\/Subtype\\s*\\/Highlight/.test(s) }; })()`);
  t.check(`${label}: save a copy`, 'Save a copy… gives a PDF that has a highlight annotation in it', copy.pdf && copy.highlightInFile && /\.pdf$/i.test(copy.name), copy);

  // the saved copy, opened again as its own document
  await page.eval(`(async () => { const d = window.__chk.dl[0]; await __reader.openFile(new File([d.blob], ${JSON.stringify('copy of ' + name)}, { type: 'application/pdf' })); return true; })()`);
  await page.waitFor(`__reader.docs.size === ${before + 2} && (__reader.docs.get(__reader.activeId()) || {}).name === ${JSON.stringify('copy of ' + name)} && ${ANN}.getState().pages && Object.keys(${ANN}.getState().pages).length > 0`, 30000, 'the saved copy to open');
  await page.waitFor(`${highlights}.length > 0`, 8000, 'the highlight in the saved copy').catch(() => {});
  const again = await page.eval(`({ pages: __reader.dm.getActiveDocument().pageCount, highlights: ${highlights} })`);
  const same = again.highlights.length === 1 && made.length === 1 && again.highlights[0].page === made[0].page && Math.abs(again.highlights[0].x - made[0].x) <= 2 && Math.abs(again.highlights[0].y - made[0].y) <= 2 && Math.abs(again.highlights[0].w - made[0].w) <= 2;
  t.check(`${label}: the copy re-opens with the highlight`, 'the saved copy has the same page count and the one highlight, in the same place', again.pages === pages && same, again);
}

export async function run(t) {
  const dir = path.join(t.work, 'reader'); fs.mkdirSync(dir, { recursive: true });
  const own = path.join(dir, 'two-pages.pdf'); fs.copyFileSync(path.join(FIX, 'two-pages.pdf'), own);
  const page = await t.open('/reader/', { preload: PRELOAD });
  await page.waitFor('window.__reader', 30000, 'the Reader to start');

  // ---- the checks' own PDF: highlight with the mouse ----
  await roundTrip(t, page, own, 'two-page PDF', async () => {
    await page.click({ name: 'the Annotate tab', js: `[...${ROOT}.querySelectorAll('button')].find(b => b.textContent.trim() === 'Annotate' && b.getBoundingClientRect().width > 0)` });
    await page.waitFor(`${ROOT}.querySelector('button[aria-label="Highlight"]')`, 5000, 'the Highlight tool');
    await page.click({ name: 'the Highlight tool', js: `${ROOT}.querySelector('button[aria-label="Highlight"]')` });
    await page.waitFor(`(${ANN}.getActiveTool() || {}).id === 'highlight'`, 5000, 'the Highlight tool to be chosen');
    await t.sleep(300); // the toolbar opening moves the page down a little
    // the fixture's line of text starts 72 pt from the left and sits about 84 pt from the top of a 612 pt wide page
    const r = await page.eval(`(() => { const im = ${ROOT}.querySelector('img'), r = im.getBoundingClientRect(); return { left: r.left, top: r.top, scale: r.width / 612 }; })()`);
    await page.drag(r.left + 84 * r.scale, r.top + 84 * r.scale, r.left + 360 * r.scale, r.top + 84 * r.scale);
  });
  const text = await page.eval(`(() => { const d = [...__reader.docs.keys()][0]; const a = Object.values(__reader.cap('annotation').forDocument(d).getState().byUid)[0]; return a && a.object.custom ? a.object.custom.text : ''; })()`);
  t.check('two-page PDF: the highlight is on the words dragged across', 'the highlight made with the mouse covers words of the line “Mixtape Reader check: page one”', /Reader check/.test(text), `“${text}”`);

  // ---- a real-world PDF, when the test folder has one ----
  const ebook = path.join(t.root, '_test', 'ebook.pdf');
  if (fs.existsSync(ebook)) {
    const mine = path.join(dir, 'ebook.pdf'); fs.copyFileSync(ebook, mine); // the run works on its own copy
    await roundTrip(t, page, mine, 'ebook.pdf', async () => {
      await page.eval(`(() => { const r = { origin: { x: 72, y: 100 }, size: { width: 200, height: 20 } }; ${ANN}.createAnnotation(0, { type: ${HIGHLIGHT}, id: crypto.randomUUID(), pageIndex: 0, rect: r, segmentRects: [r], color: '#FFCD45', strokeColor: '#FFCD45', opacity: 1, author: 'Checks', created: new Date() }); return true; })()`);
    });
  } else t.note('_test/ebook.pdf is not there: only the checks’ own two-page PDF was used');

  const csp = await page.csp();
  t.check('content policy', 'nothing refused by the Content-Security-Policy while reading and saving', csp.length === 0, csp.length ? csp.slice(0, 4) : 'nothing refused');
  t.check('no errors', 'no errors in the console during the whole flow', page.errors.length === 0, page.errors.length ? page.errors.slice(0, 4) : 'clean');
  t.private(page);
}
