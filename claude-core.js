/* Claude reads a finished transcript and sets who said what, splits a paragraph where the speaker changes in it, and
   puts in notations (an exhibit marked, a recess). It never changes a heard word: it only answers with paragraph numbers,
   exact quotes and labels, and this file applies the answer. Pure functions, no network: the page (transcribe/claude.js)
   does the asking.

   Which guidelines: a legal transcript follows TranscribeMe's guidelines, any other transcript follows Rev's (her
   choice, 2026-11-26; to be updated as they go). */

import { guideFor } from './style-guides.js';

/* ---- what is sent: the transcript as numbered paragraphs ---- */
const bare = t => String(t).toLowerCase().replace(/[^a-z0-9']+/g, '');
const clock = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60, p = n => String(n).padStart(2, '0'); return `${h ? h + ':' + p(m) : m}:${p(x)}`; };

/* paragraphs: [{ k, i0, n, s, sp, side, note, text }] in order; k is the number Claude sees. Notation lines are shown
   so it knows they are there, and are never given a speaker. */
export function paragraphs(words) {
  const out = []; let cur = null;
  words.forEach((w, i) => {
    if (i === 0 || w.p) { cur = { k: out.length, i0: i, n: 0, s: w.s ?? null, sp: w.sp || '', side: w.side || '', note: !!(w.lg && w.lg.k === 'n'), toks: [] }; out.push(cur); }
    cur.n++; cur.toks.push(String(w.t));
  });
  for (const p of out) { p.text = p.toks.join(' '); delete p.toks; }
  return out;
}
/* the transcript as text for Claude, one line per paragraph: "[12] 3:41 Speaker 1 (left): words …" */
export function asText(paras, from = 0, to = paras.length) {
  return paras.slice(from, to).map(p => `[${p.k}] ${clock(p.s)} ${p.note ? '(notation, already in the transcript)' : (p.sp || 'unlabelled') + (p.side ? ` (${p.side} side)` : '')}: ${p.text}`).join('\n');
}
/* pieces of about `size` words, so a long recording is read a part at a time (each answer stays short and quick) */
export function pieces(paras, size = 6000) {
  const out = []; let a = 0, n = 0;
  paras.forEach((p, k) => { n += p.n; if (n >= size && k < paras.length - 1) { out.push([a, k + 1]); a = k + 1; n = 0; } });
  out.push([a, paras.length]); return out;
}

/* ---- the instructions ---- */
const COMMON = `You are a senior transcript editor. You receive a transcript that a speech recogniser wrote down: numbered paragraphs, each with its start time and, where the audio told us, a speaker label or the side of the recording it came from. The paragraphs were broken where the recogniser heard a pause, so one paragraph can hold two speakers, and labels may be missing or wrong.

Your job, using the logic of the conversation:
1. Decide who the people are and give each a label (rules below). Use names only when the transcript itself gives them (a greeting, an introduction, "Ms. Dlamini, you may proceed"). Never invent a name.
2. Say who speaks, and where each paragraph begins. The paragraphs you were given were broken at every pause, which the guide does not allow ("not for a short pause"): consecutive paragraphs by the same speaker are joined into one, unless you keep a break. List in "turns": (a) every place where the speaker changes, and (b) every place where the guide wants a new paragraph although the speaker stays the same (for Rev: the speaker turns to address someone else, or after "strike that"). A place at the start of a paragraph has starts_with "". A place inside a paragraph has starts_with set to the first 3 to 8 words from that point, copied exactly from that paragraph. Any break you do not list, between paragraphs of one speaker, is removed.
3. Punctuate: for every paragraph you were given (except notations), write it out again in "paras" with sentence punctuation and capital letters as the guidelines below ask: full stops, commas, question marks, capitals at sentence starts, for names, for "I". Every sentence ends with a mark: every paragraph's text must end with a full stop, a question mark or the guide's dash for speech that trails off or is cut off. Mark every false start the guide describes: when a speaker abandons a phrase and starts again ("I went to the we drove there", "is it was it on the fifth"), put the guide's dash at the break (Rev: "I went to the -- we drove there"; TranscribeMe: "I went to the-- we drove there"). Look for them deliberately: they are common in speech. Use exactly the same words in exactly the same order: you may only change capital letters and add or move punctuation marks attached to words. Never add, drop, merge, split or respell a word; never turn number words into digits; never remove a filler (um, uh) or a repeated word: the guidelines' word rules are applied separately.
4. Put in the notations the guidelines call for, only where the words clearly show the event (an exhibit is marked or received, a recess is taken, a witness is sworn). Each goes after the paragraph given; "after" is "" for the end of that paragraph, or the exact last 3 to 8 words after which it belongs.

Evidence, strongest first: a side of the recording (left/right are different people, recorded separately: trust them), a label the audio gave, what is said (questions and answers, "Your Honour", who is addressed by name, who swears or is sworn), and the flow of the exchange. Think it through; when it is not clear, keep the label the audio gave and say why in "why".

Rules: never change, add or remove any heard word; quote exactly (quote the words as they were given to you). Paragraph numbers must be ones you were given. The first entry of "turns" must be the first paragraph you were given (unless it is a notation). Notation paragraphs get no speaker. Keep "why" short (under 20 words), and leave it "" where the change is obvious. "summary": two or three plain sentences on what you changed and what you were unsure of.`;

const LEGAL = `This is a LEGAL transcript (a hearing, deposition, trial, interview under oath). Follow TranscribeMe's guidelines, given in full below.`;

const NORMAL = `This is an ordinary transcript (an interview, a call, a meeting, a podcast). Follow Rev's style guide, given in full below.`;

const BIBLE = `THE STYLE GUIDE BELOW IS YOUR BIBLE. Follow every rule in it that concerns speakers, paragraphs, punctuation, capital letters and notations. Where anything else in these instructions seems to differ from the guide, the guide wins, except for one thing: you never add, remove or change a heard word (the guide's word rules, such as removing fillers or writing numbers as digits, are applied separately by Mixtape, which hides words without deleting them). When the guide gives an example, match its marks exactly. In "summary", say which guide rules you applied, how many false starts you marked, and any rule you could not apply.`;

export function instructions(legal) { return `${COMMON}\n\n${legal ? LEGAL : NORMAL}\n\n${BIBLE}\n\n${guideFor(legal)}`; }
export function request(paras, piece, { title = '', people = [], legal = false, cast = [] } = {}) {
  const [a, b] = piece, before = paras.slice(Math.max(0, a - 6), a);
  return [
    `Recording: ${title || 'untitled'}${legal ? ' (legal)' : ''}`,
    cast.length ? `People known from this matter (use these labels when they fit): ${cast.join('; ')}` : '',
    people.length ? `People already labelled in earlier parts of this recording (keep the same labels): ${people.map(p => `${p.id} = ${p.label}`).join('; ')}` : '',
    before.length ? `The paragraphs just before this part, for context only (do not answer for them):\n${asText(paras, Math.max(0, a - 6), a)}` : '',
    `The paragraphs to answer for (${a} to ${b - 1}):\n${asText(paras, a, b)}`,
  ].filter(Boolean).join('\n\n');
}
export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['people', 'turns', 'paras', 'inserts', 'summary'],
  properties: {
    paras: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['para', 'text'], properties: { para: { type: 'integer' }, text: { type: 'string' } } } },
    people: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'label', 'why'], properties: { id: { type: 'string' }, label: { type: 'string' }, why: { type: 'string' } } } },
    turns: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['para', 'starts_with', 'speaker', 'why'], properties: { para: { type: 'integer' }, starts_with: { type: 'string' }, speaker: { type: 'string' }, why: { type: 'string' } } } },
    inserts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['para', 'after', 'text', 'why'], properties: { para: { type: 'integer' }, after: { type: 'string' }, text: { type: 'string' }, why: { type: 'string' } } } },
    summary: { type: 'string' },
  },
};

/* ---- applying an answer ---- */
/* where `quote` begins (or ends, with end = true) among the tokens toks[a..b), matching on the bare words; -1 if not there */
export function findQuote(toks, a, b, quote, end = false) {
  const q = String(quote || '').split(/\s+/).map(bare).filter(Boolean); if (!q.length) return -1;
  const ws = []; for (let i = a; i < b; i++) ws.push(bare(toks[i]));
  for (let i = 0; i + q.length <= ws.length; i++) { let ok = true; for (let j = 0; j < q.length; j++) if (ws[i + j] !== q[j]) { ok = false; break; } if (ok) return a + (end ? i + q.length - 1 : i); }
  return -1;
}
/* answer: { people, turns, inserts } for paragraphs [a, b). Returns { words, log } — a new array; the words handed in
   are not changed. log: [{ kind: 'speaker' | 'split' | 'insert' | 'skipped', para, from, to, quote, why, text }] */
export function apply(words, paras, piece, answer) {
  const [a, b] = piece, label = new Map((answer.people || []).map(p => [p.id, String(p.label || '').trim() || p.id]));
  const log = [], toks = words.map(w => w.t);
  // every place a speaker starts, as a word index
  const starts = new Map(); // word index -> label
  const okPara = k => Number.isInteger(k) && k >= a && k < b && paras[k] && !paras[k].note;
  for (const t of answer.turns || []) {
    if (!okPara(t.para)) { log.push({ kind: 'skipped', para: t.para, why: `paragraph ${t.para} is not in this part, or is a notation` }); continue; }
    const p = paras[t.para], who = label.get(t.speaker) || String(t.speaker || '').trim(); if (!who) continue;
    let at = p.i0;
    if (t.starts_with && String(t.starts_with).trim()) { at = findQuote(toks, p.i0, p.i0 + p.n, t.starts_with); if (at < 0) { log.push({ kind: 'skipped', para: t.para, quote: t.starts_with, why: 'the quoted words were not found in that paragraph, so this change was not made' }); continue; } }
    starts.set(at, { who, why: t.why || '', para: t.para, split: at !== p.i0, quote: t.starts_with || '' });
  }
  // walk the words of this part: each paragraph (or split) gets the speaker in force
  const out = words.slice(); let who = null; const first = paras[a] ? paras[a].i0 : 0, last = b < paras.length ? paras[b].i0 : words.length;
  for (let k = a - 1; k >= 0 && who === null; k--) if (paras[k] && !paras[k].note && paras[k].sp) who = paras[k].sp; // carried in from before this part
  const paraAt = new Map(paras.map(p => [p.i0, p]));
  for (let i = first; i < last; i++) {
    const w = words[i], p = paraAt.get(i), st = starts.get(i);
    if (p && p.note) { continue; }
    if (st) {
      const was = p ? p.sp : null;
      if (st.split) log.push({ kind: 'split', para: st.para, to: st.who, quote: st.quote, why: st.why });
      else if (was !== st.who) log.push({ kind: 'speaker', para: st.para, from: was || '', to: st.who, why: st.why });
      who = st.who; out[i] = { ...w, p: true, sp: st.who };
    } else if (p && who) {
      if (p.sp !== who) log.push({ kind: 'speaker', para: p.k, from: p.sp || '', to: who, why: '' });
      out[i] = { ...w, p: true, sp: who };
    }
  }
  // the notations, from the last back so the places stay true; each is its own paragraph
  const ins = [];
  for (const x of answer.inserts || []) {
    const text = String(x.text || '').trim(); if (!text || !okPara(x.para)) { if (text) log.push({ kind: 'skipped', para: x.para, text, why: 'not a paragraph of this part' }); continue; }
    const p = paras[x.para]; let at = p.i0 + p.n - 1;
    if (x.after && String(x.after).trim()) { const e = findQuote(toks, p.i0, p.i0 + p.n, x.after, true); if (e < 0) { log.push({ kind: 'skipped', para: x.para, text, quote: x.after, why: 'the place quoted was not found, so the notation was not put in' }); continue; } at = e; }
    ins.push({ at, text, why: x.why || '', para: x.para, quote: x.after || '' });
  }
  ins.sort((p, q) => q.at - p.at);
  let res = out;
  for (const x of ins) {
    const after = res[x.at], s = after ? (after.e ?? after.s) : null, tk = x.text.split(/\s+/);
    const note = tk.map((t, j) => (j === 0 ? { t, s, e: s, p: true, lg: { k: 'n', auto: x.quote || x.text, by: 'claude' } } : { t, s, e: s }));
    const rest = res.slice(x.at + 1); if (rest.length && !rest[0].p) rest[0] = { ...rest[0], p: true, ...(who ? { sp: speakerBefore(res, x.at) } : {}) };
    res = res.slice(0, x.at + 1).concat(note, rest);
    log.push({ kind: 'insert', para: x.para, text: x.text, quote: x.quote, why: x.why });
  }
  // where Claude placed a turn (word indices after the notations went in): breaks it chose to keep
  const keep = new Set(); for (const [at] of starts) { let shift = 0; for (const x of ins) if (x.at < at) shift += x.text.split(/\s+/).length; keep.add(at + shift); }
  return { words: res, log, keep };
}
const speakerBefore = (ws, i) => { for (let k = i; k >= 0; k--) if (ws[k].p && !(ws[k].lg && ws[k].lg.k === 'n')) return ws[k].sp || ''; return ''; };

/* punctuation and capitals from Claude's "paras": each heard word takes the new form only when it is the same word
   (same letters and digits, ignoring case and marks); a word that does not line up keeps its old form. Returns
   { words, marked, refused } — a new array. */
export function punctuate(words, paras, answerParas) {
  const out = words.slice(); let marked = 0, refused = 0;
  for (const x of answerParas || []) {
    const p = paras[x.para]; if (!p || p.note || typeof x.text !== 'string') continue;
    const neu = x.text.trim().split(/\s+/).filter(Boolean); let i = 0, j = 0;
    while (i < p.n && j < neu.length) {
      if (!bare(neu[j])) { if (i > 0 && /^[-–—.,;:?!]+$/.test(neu[j])) { const prev = out[p.i0 + i - 1]; out[p.i0 + i - 1] = { ...prev, t: `${prev.t} ${neu[j].replace(/[–—]/g, '--')}` }; marked++; } j++; continue; } // a mark on its own ("--"): it goes with the word before
      const old = out[p.i0 + i], a = bare(old.t), b = bare(neu[j]);
      if (a === b) { if (old.t !== neu[j]) { out[p.i0 + i] = { ...old, t: neu[j] }; marked++; } i++; j++; continue; }
      // out of step: look a little ahead on each side for the next word that matches, and carry on from there
      let di = -1, dj = -1; for (let k = 1; k <= 3 && di < 0; k++) { if (i + k < p.n && bare(out[p.i0 + i + k].t) === b) di = k; else if (j + k < neu.length && bare(neu[j + k]) === a) dj = k; }
      refused++; if (di > 0) i += di; else if (dj > 0) j += dj; else { i++; j++; }
    }
  }
  return { words: out, marked, refused };
}

/* Paragraphs, as the guides want them: consecutive paragraphs by the same speaker become one, except where Claude kept a
   break (keep: word indices). A notation always stands alone. Returns { words, joined }. */
export function joinSameSpeaker(words, keep = new Set()) {
  const out = words.slice(); let joined = 0, prevSp = null, prevNote = true;
  for (let i = 0; i < out.length; i++) {
    const w = out[i]; if (!(i === 0 || w.p)) continue;
    const note = !!(w.lg && w.lg.k === 'n');
    if (i > 0 && !note && !prevNote && w.sp && w.sp === prevSp && !keep.has(i)) { const { p, sp, side, ...rest } = w; out[i] = rest; joined++; continue; }
    prevNote = note; if (!note) prevSp = w.sp || prevSp;
  }
  return { words: out, joined };
}
/* The guide's rules that need no judgement, made sure of after Claude: every paragraph ends with a mark (a full stop
   where none was put; a comma, semicolon or colon at the end becomes a full stop), starts with a capital, and "i" is
   always "I". Never changes a word's letters otherwise. Returns { words, ends, caps }. */
export function finish(words) {
  const out = words.slice(); let ends = 0, caps = 0;
  const starts = []; out.forEach((w, i) => { if (i === 0 || w.p) starts.push(i); });
  starts.forEach((a, k) => {
    const b = k + 1 < starts.length ? starts[k + 1] : out.length, w0 = out[a];
    if (w0.lg && w0.lg.k === 'n') return;
    // the end
    const last = b - 1, t = String(out[last].t);
    if (!/(\.|\?|!|--)["')\]]*$/.test(t)) { out[last] = { ...out[last], t: /[,;:]["')\]]*$/.test(t) ? t.replace(/[,;:](["')\]]*)$/, '.$1') : t.replace(/(["')\]]*)$/, '.$1') }; ends++; }
    // the start
    const f = String(out[a].t), m = /^([("'\[]*)([a-z])/.exec(f); if (m) { out[a] = { ...out[a], t: m[1] + m[2].toUpperCase() + f.slice(m[0].length) }; caps++; }
  });
  for (let i = 0; i < out.length; i++) { const t = String(out[i].t); if (/^i('[a-z]+)?([.,?!;:-]*)$/.test(t)) { out[i] = { ...out[i], t: 'I' + t.slice(1) }; caps++; } }
  return { words: out, ends, caps };
}
/* how many false starts carry the guide's dash */
export const dashes = words => words.filter(w => /--/.test(String(w.t))).length;

/* how much it changed, in plain numbers */
export function tally(log) {
  const n = k => log.filter(x => x.kind === k).length;
  return { speakers: n('speaker'), splits: n('split'), inserts: n('insert'), skipped: n('skipped') };
}
/* the cost of an answer, in dollars, from its usage (Claude Opus 5.5: $4 in, $20 out per million; cache reads $0.20) */
export function cost(u) { if (!u) return 0; return ((u.input_tokens || 0) * 4 + (u.cache_creation_input_tokens || 0) * 5 + (u.cache_read_input_tokens || 0) * 0.2 + (u.output_tokens || 0) * 20) / 1e6; }

/* Reading an answer while it is still arriving: the JSON comes in pieces, and each finished item of a top-level list
   ("turns", "paras", "inserts", "people") is handed over as soon as its closing brace arrives, so the page can show,
   and apply, each decision as it is made. onItem(key, item). Text that is not yet a whole item is kept for later. */
export function itemReader(onItem) {
  let buf = '', pos = 0, depth = 0, inStr = false, esc = false, key = '', keyStart = -1, lastStr = '', itemStart = -1;
  return {
    push(delta) {
      buf += delta;
      for (; pos < buf.length; pos++) {
        const c = buf[pos];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') { inStr = false; if (depth === 1) lastStr = buf.slice(keyStart + 1, pos); } continue; }
        if (c === '"') { inStr = true; keyStart = pos; continue; }
        if (c === ':' && depth === 1) { key = lastStr; continue; }
        if (c === '{' || c === '[') { depth++; if (c === '{' && depth === 3) itemStart = pos; continue; }
        if (c === '}' || c === ']') {
          if (c === '}' && depth === 3 && itemStart >= 0) { let item = null; try { item = JSON.parse(buf.slice(itemStart, pos + 1)); } catch (e) {} if (item) onItem(key, item); itemStart = -1; }
          depth--;
        }
      }
    },
  };
}
