// node claude-check.mjs — applying Claude's answer to a transcript, on an invented hearing (no network, no real recording).
import { paragraphs, asText, pieces, apply, punctuate, findQuote, tally, cost, request, instructions, SCHEMA } from './claude-core.js';
let pass = 0, fail = 0; const ok = (c, name) => { if (c) { pass++; console.log('ok   ' + name); } else { fail++; console.log('FAIL ' + name); } };
const mk = lines => { const w = []; let t = 0; for (const [sp, text, side] of lines) text.split(' ').forEach((x, k) => w.push({ t: x, s: +(t += 0.4).toFixed(2), e: +(t + 0.3).toFixed(2), ...(k === 0 ? { p: true, ...(sp ? { sp } : {}), ...(side ? { side } : {}) } : {}) })); return w; };
const words = mk([
  ['', 'We are on the record in the matter of Nkosi and the City. Ms. Pillay, you may proceed.'],
  ['', 'Thank you, Your Honour. Good morning. Where were you on the night of the fifth? I was at home with my sister.'],
  ['', 'And did you see the vehicle? Yes. I saw it from the window.'],
  ['', 'I offer this photograph. It will be marked as Exhibit A.'],
]);
const paras = paragraphs(words);
ok(paras.length === 4 && paras[1].text.startsWith('Thank you,') && paras[0].n === 18, 'paragraphs are numbered with their words: ' + paras.map(p => p.n).join(','));
ok(/^\[0\] 0:00 unlabelled: We are on the record/.test(asText(paras)), 'the text sent shows number, time, label and words: ' + asText(paras).split('\n')[0].slice(0, 50));
ok(findQuote(words.map(w => w.t), 0, words.length, 'I was at home') === paras[1].i0 + 15 && findQuote(words.map(w => w.t), 0, words.length, 'nowhere at all') === -1, 'a quote is found by its words (punctuation and capitals ignored), and a missing one is not');

const answer = { summary: 'Three people.', people: [{ id: 'P1', label: 'Judge', why: 'opens the record' }, { id: 'P2', label: 'Ms. Pillay', why: 'named and invited to proceed' }, { id: 'P3', label: 'Witness', why: 'answers' }],
  turns: [{ para: 0, starts_with: '', speaker: 'P1', why: '' }, { para: 1, starts_with: '', speaker: 'P2', why: 'thanks the judge' }, { para: 1, starts_with: 'I was at home', speaker: 'P3', why: 'an answer' },
    { para: 2, starts_with: '', speaker: 'P2', why: '' }, { para: 2, starts_with: 'Yes. I saw', speaker: 'P3', why: '' }, { para: 3, starts_with: '', speaker: 'P2', why: '' }, { para: 3, starts_with: 'nothing like this', speaker: 'P1', why: '' }, { para: 9, starts_with: '', speaker: 'P1', why: '' }],
  inserts: [{ para: 3, after: '', text: '(Exhibit A was marked for identification.)', why: 'counsel marks the photograph' }] };
const r = apply(words, paras, [0, paras.length], answer), out = r.words;
const flat = out.map(w => (w.p ? ' / ' + (w.sp ? w.sp + ': ' : '') : ' ') + w.t).join('').trim();
ok(flat === '/ Judge: We are on the record in the matter of Nkosi and the City. Ms. Pillay, you may proceed. / Ms. Pillay: Thank you, Your Honour. Good morning. Where were you on the night of the fifth? / Witness: I was at home with my sister. / Ms. Pillay: And did you see the vehicle? / Witness: Yes. I saw it from the window. / Ms. Pillay: I offer this photograph. It will be marked as Exhibit A. / (Exhibit A was marked for identification.)', 'speakers set, two paragraphs split where the speaker changes, the notation on its own line:\n     ' + flat);
const t = tally(r.log);
ok(t.speakers === 4 && t.splits === 2 && t.inserts === 1 && t.skipped === 2, 'the change log counts what was done and what was not (a quote not found, a paragraph out of range): ' + JSON.stringify(t));
const heard = out.map(w => w.t).join(' ').replace(' (Exhibit A was marked for identification.)', '');
ok(heard === words.map(w => w.t).join(' ') && words[0].sp === undefined, 'no heard word is changed, added or lost, and the words handed in are left alone');
const note = out.find(w => w.lg); ok(note && note.lg.k === 'n' && note.lg.by === 'claude' && note.lg.auto, 'a notation is marked as put in by Claude, so it is highlighted and can be undone');

// a long recording is read in parts; each part knows the people already labelled
const many = paragraphs(mk(Array.from({ length: 40 }, (_, i) => ['', `line ${i} `.repeat(200).trim()])));
const ps = pieces(many, 6000); ok(ps.length === 3 && ps[0][1] === ps[1][0] && ps[2][1] === 40 && ps[0][1] === 15, 'a long transcript is cut into parts of about 6,000 words: ' + JSON.stringify(ps));
const req = request(many, ps[2], { title: 'Test', people: [{ id: 'P1', label: 'Judge' }], legal: true });
ok(/People already labelled .*P1 = Judge/.test(req) && /for context only/.test(req) && /The paragraphs to answer for \(30 to 39\)/.test(req), 'a later part carries the people and a few paragraphs before it');
ok(/TranscribeMe/.test(instructions(true)) && /Rev's style guide/.test(instructions(false)) && !/TranscribeMe/.test(instructions(false)), 'legal transcripts follow TranscribeMe, others follow Rev');
ok(SCHEMA.required.join() === 'people,turns,paras,inserts,summary' && SCHEMA.properties.turns.items.additionalProperties === false, 'the answer has a fixed shape');
ok(Math.abs(cost({ input_tokens: 12000, output_tokens: 6000 }) - 0.168) < 1e-9, 'cost: 12,000 words in and 6,000 out on Opus 5.5 is $0.168');
{ // punctuation and capitals: only the same words, in the same order
  const w = mk([['', 'so where were you on the fifth i was at home'], ['', 'did you see it yes i did']]), ps = paragraphs(w);
  const r = punctuate(w, ps, [{ para: 0, text: 'So, where were you on the fifth? I was at home.' }, { para: 1, text: 'Did you see the car? Yes, I did.' }]);
  const t = r.words.map(x => x.t).join(' ');
  ok(t === 'So, where were you on the fifth? I was at home. Did you see it Yes, I did.', 'marks and capitals are taken word by word; an added word ("the car") is refused and the words around it still line up: ' + t);
  ok(r.words.map(x => x.t.toLowerCase().replace(/[^a-z']/g, '')).join(' ') === w.map(x => x.t).join(' ') && r.refused > 0, 'no word is changed, added or lost by punctuation (' + r.marked + ' marked, ' + r.refused + ' refused)');
  ok(punctuate(w, ps, [{ para: 0, text: 'So where were you on the 5th? I was at home.' }]).words[6].t === 'fifth', 'a number word turned into digits is refused');
  ok(SCHEMA.required.includes('paras') && /Never add, drop, merge, split or respell a word/.test(instructions(false)) && /Oxford comma/.test(instructions(false)) && /Your Honour/.test(instructions(true)), 'Claude is asked to punctuate by the guide in use, without changing words'); }

{ // Rev's double dash stands on its own between words: it is joined to the word before; TranscribeMe's goes straight after the word
  const w = mk([['', 'i went to the we drove there']]), ps = paragraphs(w);
  const rev = punctuate(w, ps, [{ para: 0, text: 'I went to the -- we drove there.' }]).words.map(x => x.t).join(' ');
  const tm = punctuate(w, ps, [{ para: 0, text: 'I went to the-- we drove there.' }]).words.map(x => x.t).join(' ');
  ok(rev === 'I went to the -- we drove there.' && tm === 'I went to the-- we drove there.', 'false starts keep each guide’s dash: ' + rev + ' / ' + tm);
  ok(/Oxford comma/.test(instructions(false)) && /semicolon/.test(instructions(false)) && /two hyphens straight after/.test(instructions(true)) && /set off with commas/.test(instructions(true)), 'Rev’s and TranscribeMe’s punctuation rules are in the instructions'); }

ok(/YOUR BIBLE/.test(instructions(true)) && /STYLE GUIDE: TranscribeMe/.test(instructions(true)) && !/STYLE GUIDE: Rev/.test(instructions(true)) && /STYLE GUIDE: Rev/.test(instructions(false)) && !/STYLE GUIDE: TranscribeMe/.test(instructions(false)), 'each transcript gets its own whole style guide as its bible: TranscribeMe for legal, Rev for the rest');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
