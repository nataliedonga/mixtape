// Style guides: a customer adds the guide they were given, as the file it came in (a PDF picked, a Word document
// dropped), and Claude gets all of it. Every guide here is invented in this run; a stand-in answers for Claude, so no
// key is used and nothing is asked of any other server.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { RETURNING } from '../lib/inpage.mjs';

export const needsBrowser = true;
const HEADER = 'Northwind Transcription House Style', PDF_RULE = 'Write the judge as THE BENCH in capitals.', DOC_RULE = 'Spell out every number below eleven in words.';

// a stand-in for Anthropic's API: remembers what it was asked and answers with the same words, speakers named
const FAKE = `window.__asked = []; window.__claudeFake = { beta: { messages: { stream: body => { const fns = []; return { on(ev, fn) { if (ev === 'text') fns.push(fn); return this; }, abort() {}, finalMessage: async () => { window.__asked.push(body);
  const txt = JSON.stringify({ summary: 'Two people.', people: [{ id: 'S1', label: 'Host', why: '' }, { id: 'S2', label: 'Guest', why: '' }], turns: [], paras: [], inserts: [] });
  fns.forEach(f => f(txt)); return { stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 }, content: [{ type: 'text', text: txt }] }; } }; } } } };
  try { localStorage.setItem('mixtape-claude-auto', '0'); } catch (e) {}`;

async function makePdf(root, file) {
  const L = await import(pathToFileURL(path.join(root, 'vendor', 'pdf-lib', 'pdf-lib.esm.min.js')).href);
  const d = await L.PDFDocument.create(), f = await d.embedFont(L.StandardFonts.Helvetica);
  const rules = ['Begin a new paragraph whenever the speaker changes.', PDF_RULE, 'End every sentence with a full stop, a question mark or a dash.', 'Leave out um and uh unless they carry meaning.', 'Write money with the sign and figures.'];
  rules.forEach((rule, i) => { const p = d.addPage([420, 300]); p.drawText(HEADER, { x: 30, y: 270, size: 10, font: f }); p.drawText(`Rule ${i + 1}`, { x: 30, y: 220, size: 14, font: f });
    p.drawText(rule, { x: 30, y: 195, size: 11, font: f }); p.drawText('This house style is made up for the checks and belongs to nobody.', { x: 30, y: 170, size: 11, font: f }); p.drawText(String(i + 1), { x: 205, y: 20, size: 9, font: f }); });
  fs.writeFileSync(file, await d.save());
}
// a Word document with nothing but paragraphs: a zip of three small files, stored without compression
function makeDocx(file, paras) {
  const files = [['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.map(t => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`]];
  const parts = [], central = []; let at = 0;
  for (const [name, text] of files) { const n = Buffer.from(name), b = Buffer.from(text), crc = zlib.crc32(b), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(b.length, 18); h.writeUInt32LE(b.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(b.length, 20); c.writeUInt32LE(b.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(at, 42);
    parts.push(h, n, b); central.push(c, n); at += 30 + n.length + b.length; }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(at, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, end]));
}

export async function run(t) {
  const dir = path.join(t.work, 'guides'); fs.mkdirSync(dir, { recursive: true });
  const FIX = path.join(t.root, 'checks', 'fixtures'), words = path.join(dir, 'talk.read-along.json'); fs.copyFileSync(path.join(FIX, 'talk.read-along.json'), words);
  const pdf = path.join(dir, 'Northwind legal style guide.pdf'), docx = path.join(dir, 'Northwind everyday guide.docx'), png = path.join(dir, 'holiday.png'), tiny = path.join(dir, 'note.txt');
  await makePdf(t.root, pdf);
  makeDocx(docx, ['Northwind everyday guide', DOC_RULE, 'Keep each speaker’s words together in one paragraph until somebody else speaks.', 'Write names as the speakers say them and check the spelling against the recording’s title.', 'This everyday guide is made up for the checks and belongs to nobody at all.']);
  fs.writeFileSync(png, 'not really a picture'); fs.writeFileSync(tiny, 'Be neat.');

  const page = await t.open('/transcribe/', { preload: RETURNING + '\n' + FAKE });
  await page.waitFor('window.__tr && window.__claude', 15000, 'Transcripts and Claude to start');
  await page.setFiles('#fileIn', [t.media.get('talk.mp3'), words]);
  await page.waitFor(`__tr.cur && __tr.cur.tr && __tr.cur.tr.done && document.querySelector('#claudeBar [data-c="guides"]') && !__claude.running`, 20000, 'the transcript and Claude’s bar');
  const sheet = () => page.eval(`(() => { const s = document.querySelector('#guideSheet'); return { open: !!(s && s.open), cards: [...s.querySelectorAll('.gcard')].map(c => ({ kind: c.dataset.kind, text: c.textContent.replace(/\\s+/g, ' ').trim(), has: c.classList.contains('has') })), foot: [...s.querySelectorAll('footer button')].map(b => b.textContent.trim()) }; })()`);
  const kept = k => page.eval(`JSON.parse(localStorage.getItem('mixtape-style-guide-${k}') || 'null')`);
  const card = k => `#guideSheet .gcard[data-kind="${k}"]`;
  const drop = async (sel, file) => { const p = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 20 }; })()`);
    const data = { items: [], files: [file], dragOperationsMask: 1 }; for (const type of ['dragEnter', 'dragOver', 'drop']) await page.b.cdp('Input.dispatchDragEvent', { type, x: p.x, y: p.y, data }, page.sid); };

  // ---- 1. the button says what to do, and opens a sheet with one place for each kind of transcript ----
  const label = await page.eval(`document.querySelector('#claudeBar [data-c="guides"]').textContent`);
  await page.click('#claudeBar [data-c="guides"]');
  await page.waitFor(`document.querySelector('#guideSheet') && document.querySelector('#guideSheet').open`, 5000, 'the style guides sheet');
  const s1 = await sheet();
  t.check('guides: the sheet opens from Claude’s bar', 'the button reads “Add your style guide…”, and the sheet has a place for legal transcripts and one for all others, each on the built-in guide', /Add your style guide/.test(label) && s1.cards.length === 2 && s1.cards.every(c => /built-in/.test(c.text) && !c.has) && /Legal transcripts/.test(s1.cards[0].text) && /All other transcripts.*this transcript/.test(s1.cards[1].text), { label, cards: s1.cards.map(c => c.text.slice(0, 90)) });

  // ---- 2. a PDF, picked: read on this computer, kept whole, and named on the card ----
  await page.b.cdp('Page.setInterceptFileChooserDialog', { enabled: true }, page.sid);
  await page.click(`${card('legal')} [data-g="pick"]`);
  await page.setFiles('#guideFile', [pdf]);
  await page.waitFor(`document.querySelector('${card('legal')}').classList.contains('has') && !document.querySelector('${card('legal')}').classList.contains('busy')`, 20000, 'the PDF to be read');
  await page.b.cdp('Page.setInterceptFileChooserDialog', { enabled: false }, page.sid);
  const s2 = await sheet(), g2 = await kept('legal');
  t.check('guides: a PDF is added by picking it', 'the card names the PDF with its 5 pages and says it was added; every rule is kept, the line printed on every page once, the page numbers not at all; the button offers to use it for this transcript', /Northwind legal style guide\.pdf/.test(s2.cards[0].text) && /5 pages/.test(s2.cards[0].text) && /Added\. Claude will follow it for every legal transcript/.test(s2.cards[0].text) && !!g2 && g2.pages === 5 && g2.text.includes(PDF_RULE) && g2.text.split(HEADER).length === 2 && !/^\d$/m.test(g2.text) && /Rule 5/.test(g2.text) && s2.foot.some(b => /Use it for this transcript and restyle/.test(b)),
    { card: s2.cards[0].text.slice(0, 200), pages: g2 && g2.pages, words: g2 && g2.words, header: g2 && g2.text.split(HEADER).length - 1, foot: s2.foot });

  // ---- 3. a Word document, dropped on the other card ----
  await drop(card('normal'), docx);
  await page.waitFor(`document.querySelector('${card('normal')}').classList.contains('has') && !document.querySelector('${card('normal')}').classList.contains('busy')`, 20000, 'the Word document to be read');
  const s3 = await sheet(), g3 = await kept('normal');
  t.check('guides: a Word document is added by dropping it', 'dropped on “All other transcripts”, it becomes that kind’s guide with its words; the legal guide is untouched; the button now offers to restyle this transcript', /Northwind everyday guide\.docx/.test(s3.cards[1].text) && /Added/.test(s3.cards[1].text) && !!g3 && g3.text.includes(DOC_RULE) && !g3.text.includes(PDF_RULE) && (await kept('legal')).text === g2.text && s3.foot.some(b => /Restyle this transcript now/.test(b)), { card: s3.cards[1].text.slice(0, 200), words: g3 && g3.words, foot: s3.foot });

  // ---- 4. files that cannot be a guide: said in plain words, and the guide already there stays ----
  await drop(card('legal'), png);
  await page.waitFor(`/PDF, a Word document/.test(document.querySelector('${card('legal')} .gnote')?.textContent || '')`, 10000, 'the message about the picture');
  const bad1 = await page.eval(`document.querySelector('${card('legal')} .gnote').textContent`);
  await drop(card('legal'), tiny);
  await page.waitFor(`/too little writing/.test(document.querySelector('${card('legal')} .gnote')?.textContent || '')`, 10000, 'the message about the short file');
  const bad2 = await page.eval(`document.querySelector('${card('legal')} .gnote').textContent`), still = await kept('legal');
  t.check('guides: a wrong file is refused in plain words', 'a picture and a one-line note are each refused with a sentence that says why; the legal guide is still the PDF', /can be a PDF, a Word document/.test(bad1) && /too little writing/.test(bad2) && still.text === g2.text && still.name === g2.name, { picture: bad1, note: bad2 });

  // ---- 5. "Read it" shows the words Claude will get ----
  await page.click(`${card('normal')} [data-g="view"]`);
  const shown = await page.eval(`document.querySelector('${card('normal')} .gtext')?.textContent || ''`);
  t.check('guides: the guide can be read in the sheet', '“Read it” shows the guide’s own words', shown.includes(DOC_RULE), shown.slice(0, 120));

  // ---- 6. restyle from the sheet: Claude is given this transcript's guide, all of it ----
  await page.click({ name: 'Restyle this transcript now', js: `[...document.querySelectorAll('#guideSheet footer button')].find(b => /Restyle this transcript now/.test(b.textContent))` });
  await page.waitFor(`window.__asked.length > 0 && !__claude.running && __tr.cur.tr.claude && __tr.cur.tr.claude.log`, 30000, 'Claude’s stand-in to be asked and to finish');
  const asked = await page.eval(`({ n: __asked.length, sys: __asked[0].system.map(x => x.text).join('\\n'), open: document.querySelector('#guideSheet').open, bar: document.querySelector('#claudeBar').textContent.replace(/\\s+/g, ' ') })`);
  t.check('guides: Claude is given the guide that was added', 'one press closes the sheet and asks Claude with the Word guide’s rule in its instructions (not the legal guide’s); the bar names the guide', asked.n === 1 && asked.sys.includes(DOC_RULE) && !asked.sys.includes(PDF_RULE) && !asked.open && /Style guide: Northwind everyday guide\.docx/.test(asked.bar) && /guide: Northwind everyday guide\.docx/.test(asked.bar), { asked: asked.n, hasRule: asked.sys.includes(DOC_RULE), bar: asked.bar.slice(-220) });

  // ---- 7. Remove goes back to the built-in guide ----
  await page.click('#claudeBar [data-c="guides"]');
  await page.waitFor(`document.querySelector('#guideSheet').open`, 5000, 'the sheet again');
  await page.click(`${card('normal')} [data-g="remove"]`);
  const s7 = await sheet(), gone = await kept('normal');
  t.check('guides: Remove puts the built-in guide back', 'the card says the built-in guide is in use again and nothing of the removed guide is kept', gone === null && /built-in guide/.test(s7.cards[1].text) && !s7.cards[1].has && /Removed from this browser/.test(s7.cards[1].text), s7.cards[1].text.slice(0, 160));
  await page.press('Escape');
  await page.waitFor(`!document.querySelector('#guideSheet').open`, 5000, 'Escape to close the sheet');

  t.check('guides: no errors', 'no errors in the console, no failed request, nothing refused by the page’s security policy', page.errors.length === 0 && page.failed.length === 0 && (await page.csp()).length === 0, page.errors.concat(page.failed, await page.csp()).slice(0, 4).join(' / ') || 'clean');
  t.private(page, 'guides: nothing asked of another server');
}
