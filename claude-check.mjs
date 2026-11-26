// node claude-check.mjs — applying Claude's answer to a transcript, on an invented hearing (no network, no real recording).
import { paragraphs, asText, pieces, apply, punctuate, restyle, applyOps, itemReader, joinSameSpeaker, finish, dashes, findQuote, tally, cost, request, instructions, SCHEMA } from './claude-core.js';
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
ok(/STYLE GUIDE: TranscribeMe/.test(instructions(true)) && /STYLE GUIDE: Rev/.test(instructions(false)) && !/STYLE GUIDE: TranscribeMe/.test(instructions(false)), 'legal transcripts follow TranscribeMe, others follow Rev');
ok(SCHEMA.required.join() === 'people,turns,paras,inserts,summary' && SCHEMA.properties.turns.items.additionalProperties === false, 'the answer has a fixed shape');
ok(Math.abs(cost({ input_tokens: 12000, output_tokens: 6000 }) - 0.168) < 1e-9, 'cost: 12,000 words in and 6,000 out on Opus 5.5 is $0.168');
{ // a paragraph as Claude styled it, laid over the heard words; what was heard is kept underneath
  const w = mk([['', 'so um where were you on the the fifth i i was at home'], ['', "i'm gonna pay four hundred fifty five dollars yes"]]), ps = paragraphs(w);
  const r = restyle(w, ps, [{ para: 0, text: 'So where were you on the-- the 5th? I-- I was at really home.' }, { para: 1, text: "I'm going to pay $455. Yes." }]);
  const shown = r.words.filter(x => !x.cut).map(x => x.t).join(' ');
  ok(shown === "So where were you on the-- the 5th? I-- I was at home. I'm going to pay $455. Yes.", 'marks, the guide’s dashes, a filler left out, forms written out and money in digits are taken; a word from nowhere ("really") is refused: ' + shown);
  ok(r.words.length === w.length && r.words.filter(x => x.cut).map(x => x.t).join(' ') === 'um hundred fifty five dollars', 'nothing is deleted: left-out words are kept, hidden: ' + r.words.filter(x => x.cut).map(x => x.t).join(' '));
  const o = r.words.filter(x => x.o).map(x => `${x.o} > ${x.t}`).join(' | ');
  ok(o === 'fifth > 5th? | gonna > going to | four hundred fifty five dollars > $455.', 'every restyled word keeps what was heard: ' + o);
  ok(r.cut === 5 && r.styled === 3 && r.refused === 1 && r.changes.some(c => c.from === 'um' && c.to === ''), `counted: ${r.marked} marked, ${r.styled} restyled, ${r.cut} left out, ${r.refused} refused`);
  // read again later: cut words are not shown to Claude, and quotes match across them and inside "going to"
  const ps2 = paragraphs(r.words), toks = r.words.map(x => (x.cut ? '' : x.t));
  ok(ps2[1].text === "I'm going to pay $455. Yes." && findQuote(toks, 0, toks.length, 'So where were') === 0 && findQuote(toks, 0, toks.length, 'to pay $455') < 0 && findQuote(toks, 0, toks.length, 'going to pay') === ps2[1].i0 + 1, 'a later reading sees the styled text, and a quote can run across left-out words');
  ok(restyle(w, ps, [{ para: 0, text: 'Where was he on the fifth, and was anybody home with him at that time, or did he go out somewhere else later on?' }]).refused > 0, 'a rewrite of the whole paragraph is refused');
  ok(SCHEMA.required.includes('paras') && /never paraphrase, never correct grammar, never add a word/.test(instructions(false)) && /Oxford comma/.test(instructions(false)) && /Mixtape keeps the original words underneath/.test(instructions(true)), 'Claude is told to style by the guide, word rules included, and nothing else'); }
{ // her own guide replaces the built-in one, whole
  const t = instructions(true, 'MY OWN LEGAL GUIDE: speakers are THE COURT and Q and A.');
  ok(/MY OWN LEGAL GUIDE/.test(t) && !/STYLE GUIDE: TranscribeMe/.test(t) && /YOUR BIBLE/.test(t), 'a guide she loaded is used as the bible, in place of the built-in one'); }
{ // changes asked for in the chat
  const w = mk([['A', 'good morning how can i help'], ['B', 'my order is late yes'], ['A', 'i am sorry']]);
  const r = applyOps(w, [{ op: 'rename_speaker', from: 'A', to: 'AGENT' }, { op: 'set_speaker', para: 1, starts_with: 'yes', speaker: 'AGENT' }, { op: 'set_text', para: 0, text: 'Good morning. How can I help?' }, { op: 'insert_line', para: 1, after: '', text: '(Pause.)' }, { op: 'set_speaker', para: 9, speaker: 'X' }]);
  const flat = r.words.map(x => (x.p ? ' / ' + (x.sp ? x.sp + ': ' : '') : ' ') + x.t).join('').trim();
  ok(flat === '/ AGENT: Good morning. How can I help? / B: my order is late / AGENT: yes / (Pause.) / AGENT: i am sorry' && r.done.length === 4 && r.failed.length === 1, 'chat changes are carried out on the paragraphs as shown, and one that cannot be is reported: ' + flat + ' | failed: ' + r.failed.join());
  const r2 = applyOps(r.words, [{ op: 'remove_line', para: 3 }, { op: 'join_with_previous', para: 2 }]);
  ok(r2.words.map(x => (x.p ? ' / ' + (x.sp || '') + ': ' : ' ') + x.t).join('').trim() === '/ AGENT: Good morning. How can I help? / B: my order is late yes / AGENT: i am sorry', 'a line can be removed and a break joined: ' + r2.done.join('; ')); }


{ // Rev's double dash stands on its own between words: it is joined to the word before; TranscribeMe's goes straight after the word
  const w = mk([['', 'i went to the we drove there']]), ps = paragraphs(w);
  const rev = punctuate(w, ps, [{ para: 0, text: 'I went to the -- we drove there.' }]).words.map(x => x.t).join(' ');
  const tm = punctuate(w, ps, [{ para: 0, text: 'I went to the-- we drove there.' }]).words.map(x => x.t).join(' ');
  ok(rev === 'I went to the -- we drove there.' && tm === 'I went to the-- we drove there.', 'false starts keep each guide’s dash: ' + rev + ' / ' + tm);
  ok(/Oxford comma/.test(instructions(false)) && /semicolon/.test(instructions(false)) && /two hyphens straight after/.test(instructions(true)) && /set off with commas/.test(instructions(true)), 'Rev’s and TranscribeMe’s punctuation rules are in the instructions'); }

ok(/YOUR BIBLE/.test(instructions(true)) && /STYLE GUIDE: TranscribeMe/.test(instructions(true)) && !/STYLE GUIDE: Rev/.test(instructions(true)) && /STYLE GUIDE: Rev/.test(instructions(false)) && !/STYLE GUIDE: TranscribeMe/.test(instructions(false)), 'each transcript gets its own whole style guide as its bible: TranscribeMe for legal, Rev for the rest');

{ // an answer read while it arrives, in small pieces, items handed over as each one closes
  const json = JSON.stringify({ people: [{ id: 'P1', label: 'Judge', why: 'says "order" {in court}' }], turns: [{ para: 0, starts_with: '', speaker: 'P1', why: '' }, { para: 2, starts_with: 'yes I {did}', speaker: 'P2', why: 'a "quote" \ and brace }' }], paras: [{ para: 0, text: 'Order, please.' }], inserts: [], summary: 'done' });
  const got = []; const rd = itemReader((k, x) => got.push(k + ':' + (x.para ?? x.id)));
  for (let i = 0; i < json.length; i += 7) rd.push(json.slice(i, i + 7));
  ok(got.join(' ') === 'people:P1 turns:0 turns:2 paras:0', 'items are read as they arrive, even with braces and quotes inside the text: ' + got.join(' ')); }

{ // the guide's paragraph rule: one speaker's pause breaks are joined; a kept break and a notation stay
  const w = mk([['A', 'so I went'], ['A', 'to the shop'], ['B', 'and then'], ['B', 'Your Honour may I'], ['B', 'strike that']]);
  w.splice(6, 0, { t: '(A', s: 2, e: 2, p: true, lg: { k: 'n' } }, { t: 'recess.)', s: 2, e: 2 });
  const ps0 = paragraphs(w), keep = new Set([ps0[5].i0]); // Claude kept the break at "strike that"
  const j = joinSameSpeaker(w, keep), flat = j.words.map(x => (x.p ? ' / ' + (x.sp ? x.sp + ': ' : '') : ' ') + x.t).join('').trim();
  ok(flat === '/ A: so I went to the shop / (A recess.) / B: and then Your Honour may I / B: strike that' && j.joined === 2, 'pause breaks by one speaker are joined; a notation and a break Claude kept stay: ' + flat + ' (' + j.joined + ' joined)'); }
{ // the rules that need no judgement
  const w = mk([['A', 'so where were you'], ['B', 'i was at home,'], ['A', 'and then you --'], ['B', "yes i'm sure?"]]);
  // (nothing else to set up)
  const f = finish(w), t = f.words.map(x => (x.p ? ' / ' : ' ') + x.t).join('').trim();
  ok(t === "/ So where were you. / I was at home. / And then you -- / Yes I'm sure?", 'every paragraph ends with a mark (a dash counts), starts with a capital; "i" is "I"; a comma at the end becomes a full stop: ' + t);
  ok(f.ends >= 2 && f.caps >= 3, 'what Mixtape fixed itself is counted: ' + f.ends + ' ends, ' + f.caps + ' capitals'); }
{ const w = mk([['A', 'I went to the -- we drove there.']]); ok(dashes(w) === 1 && dashes(finish(w).words) === 1, 'false starts with the guide’s dash are counted, and a paragraph already ending with a mark is left alone'); }

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
