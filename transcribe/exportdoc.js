/* A transcript as a Word document or a PDF, made in this page (nothing is sent anywhere).

   Word: a .docx is a zip of a few small XML files; this writes the smallest valid one (a title, then one paragraph per
   turn: the time stamp, the speaker's name in bold, the words). The zip is written uncompressed with ../reader/zip.js.
   PDF: drawn with pdf-lib (MIT, ../vendor/pdf-lib) in Times, on US Letter with one-inch margins and a page number at
   the foot. Its built-in fonts cover Western European letters; a character outside them is written as "?". */
import { storedCopy } from '../reader/zip.js';
const xml = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const LIB = new URL('../vendor/pdf-lib/pdf-lib.esm.min.js', import.meta.url).href;

/* doc: { title, note (a first line, e.g. the sensitive warning, or ''), paras: [{ time, speaker, text }] } */
export async function toDocx(doc) {
  const run = (t, opt = '') => `<w:r>${opt ? `<w:rPr>${opt}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
  const para = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
  const body = [para(run(doc.title, '<w:b/><w:sz w:val="32"/>'), '<w:spacing w:after="240"/>')];
  if (doc.note) body.push(para(run(doc.note, '<w:b/>'), '<w:spacing w:after="240"/>'));
  for (const p of doc.paras) body.push(para((p.time ? run(`[${p.time}] `, '<w:color w:val="666666"/>') : '') + (p.speaker ? run(p.speaker + ': ', '<w:b/>') : '') + run(p.text), '<w:spacing w:after="200"/>'));
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`,
  };
  const enc = new TextEncoder(), names = Object.keys(files);
  const zip = await storedCopy({ names, bytes: async n => enc.encode(files[n]) });
  return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}
export async function toPdf(doc) {
  const { PDFDocument, StandardFonts, rgb } = await import(LIB);
  const pdf = await PDFDocument.create(); pdf.setTitle(doc.title); pdf.setProducer('Mixtape'); pdf.setCreator('Mixtape Transcripts');
  const font = await pdf.embedFont(StandardFonts.TimesRoman), bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const W = 612, H = 792, M = 72, size = 12, lead = 16, width = W - 2 * M;
  const safe = s => [...String(s).replace(/\s+/g, ' ')].map(ch => { try { font.encodeText(ch); return ch; } catch (e) { return '?'; } }).join('');
  let page, y; const pages = [];
  const next = () => { page = pdf.addPage([W, H]); pages.push(page); y = H - M; };
  const line = segs => { if (y < M + lead) next(); let x = M; for (const [t, f, col] of segs) { page.drawText(t, { x, y: y - size, size, font: f, color: col || rgb(0, 0, 0) }); x += f.widthOfTextAtSize(t, size); } y -= lead; };
  /* one paragraph: runs of [text, font, colour], wrapped word by word to the page width */
  const para = runs => {
    let segs = [], used = 0;
    for (const [text, f, col] of runs) for (const word of safe(text).split(' ').filter(Boolean)) {
      const w = f.widthOfTextAtSize(word + ' ', size);
      if (used + f.widthOfTextAtSize(word, size) > width && segs.length) { line(segs); segs = []; used = 0; }
      const last = segs[segs.length - 1]; if (last && last[1] === f && last[2] === col) last[0] += word + ' '; else segs.push([word + ' ', f, col]); used += w;
    }
    if (segs.length) line(segs); y -= 8;
  };
  next();
  page.drawText(safe(doc.title), { x: M, y: y - 16, size: 16, font: bold }); y -= 34;
  if (doc.note) para([[doc.note, bold]]);
  for (const p of doc.paras) para([...(p.time ? [[`[${p.time}]`, font, rgb(0.4, 0.4, 0.4)]] : []), ...(p.speaker ? [[p.speaker + ':', bold]] : []), [p.text, font]]);
  pages.forEach((pg, k) => { const t = `${k + 1}`; pg.drawText(t, { x: (W - font.widthOfTextAtSize(t, 10)) / 2, y: M / 2, size: 10, font, color: rgb(0.4, 0.4, 0.4) }); });
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
