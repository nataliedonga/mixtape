/* Reading a style guide from the file people actually have: a PDF, a Word document or plain text.
   Everything happens on this device: the PDF is read with the Reader's own engine (EmbedPDF's PDFium, MIT, in
   ../vendor/embedpdf) and Word with mammoth (BSD-2-Clause, ../vendor/mammoth). Nothing is fetched from anywhere else. */
const V = new URL('../vendor/', import.meta.url).href;
const wait = t => (t && typeof t.toPromise === 'function' ? t.toPromise() : new Promise((res, rej) => t.wait(res, e => rej(e && (e.reason || e)))));
export const ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown';
export const MIN = 200, MAX = 400000;
const say = (m, why) => Object.assign(new Error(m), { friendly: true, why });

/* Pages of text -> one text. Lines printed on most pages (a running header, a confidentiality footer) and bare page
   numbers say nothing about style: they are kept once, at the top, and taken out of the pages. */
export function tidyPages(pages) {
  const lines = pages.map(p => String(p || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t ]+/g, ' ').trim()));
  const seen = new Map();
  if (pages.length >= 4) for (const ls of lines) for (const l of new Set(ls)) if (l.length >= 4) seen.set(l, (seen.get(l) || 0) + 1);
  const running = new Set([...seen].filter(([, n]) => n >= Math.ceil(pages.length * 0.6)).map(([l]) => l));
  const out = lines.map(ls => ls.filter(l => !running.has(l) && !/^(page\s+)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim()).filter(Boolean);
  return ([...running].join('\n') + (running.size ? '\n\n' : '') + out.join('\n\n')).trim();
}
export const countWords = t => (String(t || '').match(/\S+/g) || []).length;

let mammothP = null;
const mammoth = () => mammothP ||= new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = V + 'mammoth/mammoth.browser.min.js';
  s.onload = () => (window.mammoth ? res(window.mammoth) : rej(new Error('the Word reader did not start'))); s.onerror = () => { mammothP = null; rej(new Error('the Word reader could not be loaded')); };
  document.head.appendChild(s);
});
let engineP = null;
const engine = () => engineP ||= (async () => {
  const { createPdfiumEngine } = await import(V + 'embedpdf/direct-engine-DVLMOJWp.js');
  const e = await createPdfiumEngine(V + 'embedpdf/pdfium.wasm');
  if (typeof e.initialize === 'function') { try { await wait(e.initialize()); } catch (err) {} }
  return e;
})().catch(e => { engineP = null; throw e; });

async function pdfPages(buf) {
  const eng = await engine();
  let doc; try { doc = await wait(eng.openDocumentBuffer({ id: 'guide-' + Date.now(), content: buf })); }
  catch (e) { throw say(/password/i.test(String(e && (e.message || e))) ? 'This PDF is locked with a password. Save a copy without the password and add that.' : 'This PDF could not be opened. It may be damaged: try saving it again, or add the guide as a Word or text file.', 'open'); }
  try { const pages = []; for (const p of doc.pages) pages.push(await wait(eng.extractText(doc, [p.index]))); return pages; }
  finally { try { await wait(eng.closeDocument(doc)); } catch (e) {} }
}

/* file -> { name, text, pages (PDF only), words }. Throws an Error with .friendly and a message fit to show as it is. */
export async function readGuide(file) {
  const name = file.name || 'Style guide', ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase() || '';
  if (file.size > 40e6) throw say('That file is very large for a style guide (over 40 MB). Add the guide itself, without other attachments.', 'big');
  let text = '', pages = 0;
  if (ext === 'pdf' || file.type === 'application/pdf') {
    const ps = await pdfPages(await file.arrayBuffer()); pages = ps.length; text = tidyPages(ps);
    if (text.replace(/\s+/g, '').length < MIN) throw say(`This PDF is ${pages} page${pages === 1 ? '' : 's'} of pictures (a scan), so there are no words in it to read. Open it in Mixtape’s Reader, press “Make searchable”, and add the new file here.`, 'scan');
  } else if (ext === 'docx') {
    let r; try { r = await (await mammoth()).extractRawText({ arrayBuffer: await file.arrayBuffer() }); } catch (e) { throw say('This Word document could not be read. Try “Save as PDF” in Word and add the PDF.', 'open'); }
    text = tidyPages([r.value]);
  } else if (ext === 'doc' || ext === 'rtf' || ext === 'odt' || ext === 'pages') {
    throw say(`Mixtape cannot read .${ext} files. Open it and save it as a PDF or a Word (.docx) file, then add that.`, 'kind');
  } else if (ext === 'txt' || ext === 'md' || /^text\//.test(file.type || '')) {
    text = tidyPages([await file.text()]);
  } else throw say('A style guide can be a PDF, a Word document (.docx) or a text file.', 'kind');
  if (text.replace(/\s+/g, '').length < MIN) throw say('There is too little writing in that file to be a style guide.', 'short');
  if (text.length > MAX) throw say(`That is a very long document (${countWords(text).toLocaleString()} words). A style guide for Claude can be up to about 60,000 words: add the guide alone, without other manuals.`, 'long');
  return { name, text, pages, words: countWords(text) };
}
