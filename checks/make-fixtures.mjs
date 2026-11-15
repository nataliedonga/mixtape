// Writes the small fixed files the checks use into checks/fixtures/. Run it again only when a fixture should change:
//   node checks/make-fixtures.mjs
// Sound and video are NOT fixtures: they are made with ffmpeg into the run's temp folder each time (lib/media.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

// ---- two transcripts "made elsewhere" for 30-second recordings: one word a second, from 1 s to 26 s ----
const TEXT = 'This is a short transcript made for the checks. Every word has its own second, so a click on a word must move the playback there.'.split(' ');
const words = TEXT.map((w, i) => ({ t: w, s: i + 1, e: i + 1.8, c: i % 7 === 3 ? 0.55 : 0.97, ...(i % 10 === 0 ? { p: true, sp: i % 20 === 0 ? 'Speaker 1' : 'Speaker 2' } : {}) }));
const transcript = extra => JSON.stringify({ mode: 'heard', duration: 30, ...extra, words }, null, 1) + '\n';
fs.writeFileSync(path.join(OUT, 'talk.read-along.json'), transcript({ title: 'talk', audio: 'talk.mp3' }));
fs.writeFileSync(path.join(OUT, 'private.read-along.json'), transcript({ title: 'private', audio: 'private.mp3', sensitive: true }));

// ---- a two-page PDF, written by hand: one line of text on each page ----
function pdf(pages) {
  const objs = [], add = body => { objs.push(body); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pagesId = objs.length + 1 + pages.length * 2; // the Pages object comes after every page and its content
  const kids = [];
  for (const text of pages) {
    const stream = `BT /F1 24 Tf 72 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
  }
  add(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n'; const at = [];
  objs.forEach((b, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + at.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
fs.writeFileSync(path.join(OUT, 'two-pages.pdf'), pdf(['Mixtape Reader check: page one', 'Mixtape Reader check: page two']));

for (const f of fs.readdirSync(OUT)) console.log(`${f}  ${fs.statSync(path.join(OUT, f)).size} bytes`);
