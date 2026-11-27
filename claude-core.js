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
    cur.n++; if (!w.cut) cur.toks.push(String(w.t));
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
const COMMON = `You are a senior transcript editor. You receive a transcript that a speech recogniser wrote down: numbered paragraphs, each with its start time and, where the audio told us, a speaker label or the side of the recording it came from. The paragraphs were broken wherever the recogniser heard a pause, so one paragraph can hold two speakers, and labels may be missing or wrong. The words are raw: little or no punctuation, stutters and fillers as heard.

Your job is to turn it into a transcript that follows the style guide given below, using the logic of the conversation:
1. Decide who the people are. Label each speaker exactly the way the guide labels speakers (its speaker IDs, its capitals, its question-and-answer labels where the guide uses them and the conversation is in that mode). Use names only when the transcript itself gives them. Never invent a name. List the people in "people" (id, label, why).
2. Say who speaks, and where each paragraph begins. Consecutive paragraphs by the same speaker are joined into one unless you keep a break. List in "turns": (a) every place where the speaker changes, and (b) every place where the guide wants a new paragraph although the speaker stays the same (see the guide's paragraph rules). "speaker" is the label to print there. A place at the start of a paragraph has starts_with "". A place inside a paragraph has starts_with set to the first 3 to 8 words from that point, copied exactly as they were given to you. Any break between two paragraphs of one speaker that you do not list is removed.
3. Write every paragraph you were given out again in "paras", styled exactly as the guide requires: its punctuation and capitals, and its word rules too (for example: leaving out stutters, partial words and the fillers the guide says to leave out; writing informal forms the way the guide says; numbers, money, dates and times in the guide's format; quotation marks; the guide's spellings; its marks for false starts, repetitions and interruptions). Everything the guide does not tell you to change stays word for word and in order: never paraphrase, never correct grammar, never add a word that was not said. You cannot hear the audio, so never add a tag such as [inaudible] or [crosstalk]. Mixtape keeps the original words underneath every change you make, so the person checking can see and undo each one.
4. Lines that are not speech (notations, parentheticals): only if the guide has them, in the guide's exact form, and only where the words clearly show the event; list them in "inserts" ("after" is "" for the end of that paragraph, or the exact last 3 to 8 words after which it belongs). If the guide has no such lines, "inserts" is empty.

Evidence for who is speaking, strongest first: a side of the recording (left/right are different people, recorded separately: trust them), a label the audio gave, what is said (questions and answers, forms of address, who is named, who swears or is sworn), and the flow of the exchange. Think it through; when it is not clear, keep the label the audio gave and say why in "why".

Rules: paragraph numbers must be ones you were given. The first entry of "turns" must be the first paragraph you were given (unless it is a notation). Keep "why" short (under 20 words), and leave it "" where the change is obvious. "summary": two or three plain sentences on what you changed and what you were unsure of.`;

const LEGAL = `This is a LEGAL transcript (a hearing, deposition, trial, interview under oath). Follow the style guide for legal transcripts, given in full below.`;

const NORMAL = `This is an ordinary transcript (an interview, a call, a meeting, a podcast). Follow the style guide for ordinary transcripts, given in full below.`;

const BIBLE = `THE STYLE GUIDE BELOW IS YOUR BIBLE. Follow every rule in it. Where anything above seems to differ from the guide, the guide wins. When the guide gives an example, match its form exactly. Parts of the guide that need the audio (tags for unclear speech), outside research, or the transcriber's own tools do not apply to you: skip them. In "summary", say which guide rules you applied most and any rule you could not apply.`;

/* own: the user's own guide text for this kind of transcript (kept in her browser, never in Mixtape's code); else the built-in one */
export function instructions(legal, own = '') { return `${COMMON}\n\n${legal ? LEGAL : NORMAL}\n\n${BIBLE}\n\n${own && own.trim() ? own.trim() : guideFor(legal)}`; }
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
/* where `quote` begins (or ends, with end = true) among toks[a..b), matching on the bare letters; -1 if not there.
   Empty tokens (words that were cut) are passed over, and a token may hold several words ("going to"). */
export function findQuote(toks, a, b, quote, end = false) {
  const q = bare(quote); if (!q) return -1;
  const idx = [], bs = []; for (let i = a; i < b; i++) { const x = bare(toks[i]); if (x) { idx.push(i); bs.push(x); } }
  for (let i = 0; i < bs.length; i++) { let acc = '', k = i; while (k < bs.length && acc.length < q.length) acc += bs[k++]; if (acc === q) return end ? idx[k - 1] : idx[i]; }
  return -1;
}
/* answer: { people, turns, inserts } for paragraphs [a, b). Returns { words, log } — a new array; the words handed in
   are not changed. log: [{ kind: 'speaker' | 'split' | 'insert' | 'skipped', para, from, to, quote, why, text }] */
/* given: the words as they were when Claude was asked (same length, same order). Claude quotes places in the words it was
   GIVEN, so the quotes are looked up there: by the time this runs the paragraph may already be restyled (a spelling
   corrected, a filler left out), and the quote would no longer be found in it. */
export function apply(words, paras, piece, answer, given = words) {
  const [a, b] = piece, label = new Map((answer.people || []).map(p => [p.id, String(p.label || '').trim() || p.id]));
  const log = [], toks = (given.length === words.length ? given : words).map(w => (w.cut ? '' : w.t));
  // every place a speaker starts, as a word index
  const starts = new Map(); // word index -> label
  const okPara = k => Number.isInteger(k) && k >= a && k < b && paras[k] && !paras[k].note;
  for (const t of answer.turns || []) {
    if (!okPara(t.para)) { log.push({ kind: 'skipped', para: t.para, why: `paragraph ${t.para} is not in this part, or is a notation` }); continue; }
    const p = paras[t.para], who = label.get(t.speaker) || String(t.speaker || '').trim(); if (!who) continue;
    let at = p.i0;
    if (t.starts_with && String(t.starts_with).trim()) { at = findQuote(toks, p.i0, p.i0 + p.n, t.starts_with); if (at < 0) { log.push({ kind: 'skipped', para: t.para, quote: t.starts_with, why: 'the quoted words were not found in that paragraph, so this change was not made' }); continue; } }
    if (at !== p.i0) while (at < p.i0 + p.n - 1 && words[at].cut) at++; // a turn that begins on a word since left out begins on the next word that shows
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

/* A paragraph as Claude styled it, laid over the heard words. The two are lined up word by word (longest common run
   of the same letters). Where they agree, the word takes the new marks and capitals. Where Claude left words out (a
   stutter, a filler the guide drops), those words are cut: kept in the data, hidden. Where it wrote something else
   for a run of words ("gonna" as "going to", "four fifty five dollars" as "$455"), the first word shows the styled
   form and keeps what was heard in .o, and the rest of the run is cut. Words Claude added from nowhere are refused,
   and so is a rewrite of more than 12 words at once. Nothing is ever deleted, and the number of words never changes.
   Returns { words, marked, styled, cut, refused, changes: [{ from, to }] }. */
const MARK = /^[-–—.,;:?!"'()\[\]]+$/;
function newTokens(text) { // marks standing alone (" -- ", " - ") go with the word before them
  const out = []; for (const t of String(text || '').trim().split(/\s+/).filter(Boolean)) { if (MARK.test(t) && !bare(t) && out.length) out[out.length - 1] += ' ' + t.replace(/[–—]/g, '--'); else out.push(t); } return out;
}
export function restyle(words, paras, answerParas) {
  const out = words.slice(), changes = []; let marked = 0, styled = 0, cut = 0, refused = 0;
  for (const x of answerParas || []) {
    const p = paras[x.para]; if (!p || p.note || typeof x.text !== 'string') continue;
    const oi = []; for (let i = p.i0; i < p.i0 + p.n; i++) if (!out[i].cut) oi.push(i);
    const A = oi.map(i => bare(out[i].t)), N = newTokens(x.text), B = N.map(bare), n = A.length, m = B.length;
    if (!n) continue;
    // longest common subsequence
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] && A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0; const hunk = (i0, i1, j0, j1) => {
      if (i0 === i1 && j0 === j1) return;
      if (i0 === i1) { refused += j1 - j0; return; } // words from nowhere
      if (i1 - i0 > 12 || j1 - j0 > 12) { refused += Math.max(i1 - i0, j1 - j0); return; } // too much rewritten at once
      const heard = oi.slice(i0, i1).map(k => out[k].o ?? out[k].t).join(' ');
      if (j0 === j1) { for (let k = i0; k < i1; k++) { out[oi[k]] = { ...out[oi[k]], cut: 'claude' }; cut++; } changes.push({ from: heard, to: '' }); return; }
      const first = oi[i0], to = N.slice(j0, j1).join(' ');
      out[first] = { ...out[first], t: to, o: heard }; styled++; changes.push({ from: heard, to });
      for (let k = i0 + 1; k < i1; k++) { out[oi[k]] = { ...out[oi[k]], cut: 'claude' }; cut++; }
    };
    let hi = 0, hj = 0;
    while (i < n && j < m) {
      if (A[i] && A[i] === B[j]) { hunk(hi, i, hj, j); const k = oi[i]; if (out[k].t !== N[j]) { out[k] = { ...out[k], t: N[j] }; marked++; } i++; j++; hi = i; hj = j; }
      else if (L[i + 1][j] >= L[i][j + 1]) i++; else j++;
    }
    hunk(hi, n, hj, m);
  }
  return { words: out, marked, styled, cut, refused, changes };
}
export const punctuate = restyle; // its first form only added marks

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
    let last = b - 1; while (last > a && out[last].cut) last--; if (out[last].cut) return; const t = String(out[last].t);
    if (!/(\.|\?|!|--)["')\]]*$/.test(t)) { out[last] = { ...out[last], t: /[,;:]["')\]]*$/.test(t) ? t.replace(/[,;:](["')\]]*)$/, '.$1') : t.replace(/(["')\]]*)$/, '.$1') }; ends++; }
    // the start
    let fa = a; while (fa < b - 1 && out[fa].cut) fa++; const f = String(out[fa].t), m = /^((?:--)?[("'\[]*)([a-z])/.exec(f); if (m && !/^--/.test(f)) { out[fa] = { ...out[fa], t: m[1] + m[2].toUpperCase() + f.slice(m[0].length) }; caps++; } // a line that continues after an interruption ("--and then") keeps its small letter
  });
  for (let i = 0; i < out.length; i++) { const t = String(out[i].t); if (/^i('[a-z]+)?([.,?!;:-]*)$/.test(t)) { out[i] = { ...out[i], t: 'I' + t.slice(1) }; caps++; } }
  return { words: out, ends, caps };
}
/* how many false starts carry the guide's dash */
export const dashes = words => words.filter(w => !w.cut && /--/.test(String(w.t))).length;

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

/* ---- changes asked for in the chat ----
   ops refer to the paragraph numbers of the transcript as it was shown. They are carried out from the last paragraph
   back, so the numbers stay true. Returns { words, done: [plain lines], failed: [plain lines] }. */
export const EDIT_TOOL = {
  name: 'edit_transcript',
  description: 'Change the transcript as the person asked. Paragraph numbers are those of the transcript as shown to you. Use set_text to rewrite one paragraph in the styled form wanted (same words in the same order, apart from what the style guide or her instruction changes); set_speaker to give a paragraph, or the part of it starting at starts_with, to a speaker; rename_speaker to change a label everywhere; split to start a new paragraph (same speaker) at starts_with; join_with_previous to remove a paragraph break; insert_line to add a line that is not speech after a paragraph; remove_line to take such a line out.',
  input_schema: { type: 'object', additionalProperties: false, required: ['ops'], properties: { ops: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['op'], properties: {
    op: { type: 'string', enum: ['set_text', 'set_speaker', 'rename_speaker', 'split', 'join_with_previous', 'insert_line', 'remove_line'] },
    para: { type: 'integer' }, starts_with: { type: 'string' }, speaker: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, text: { type: 'string' }, after: { type: 'string' } } } } } },
};
export function applyOps(words, ops) {
  const paras = paragraphs(words), done = [], failed = []; let out = words.slice();
  const toks = () => out.map(w => (w.cut ? '' : w.t));
  const list = (ops || []).map((o, k) => ({ ...o, k })).sort((x, y) => (y.para ?? -1) - (x.para ?? -1) || y.k - x.k);
  for (const o of list) {
    if (o.op === 'rename_speaker') { const n = out.filter(w => w.sp === o.from).length; if (!n || !String(o.to || '').trim()) { failed.push(`no speaker is called "${o.from}"`); continue; } out = out.map(w => (w.sp === o.from ? { ...w, sp: String(o.to).trim() } : w)); done.push(`"${o.from}" is now "${o.to}" everywhere (${n} paragraphs)`); continue; }
    const p = paras[o.para]; if (!p) { failed.push(`there is no paragraph ${o.para}`); continue; }
    const at = () => { if (!o.starts_with || !String(o.starts_with).trim()) return p.i0; return findQuote(toks(), p.i0, p.i0 + p.n, o.starts_with); };
    if (o.op === 'set_text') { if (p.note) { failed.push(`paragraph ${o.para} is not speech`); continue; } const r = restyle(out, paras, [{ para: o.para, text: o.text }]); out = r.words; done.push(`paragraph ${o.para} rewritten (${r.marked} marks, ${r.styled} restyled, ${r.cut} left out${r.refused ? `, ${r.refused} refused: only heard words can be kept` : ''})`); }
    else if (o.op === 'set_speaker' || o.op === 'split') {
      const i = at(); if (i < 0) { failed.push(`the words "${o.starts_with}" are not in paragraph ${o.para}`); continue; } if (p.note) { failed.push(`paragraph ${o.para} is not speech`); continue; }
      const who = o.op === 'split' ? p.sp : String(o.speaker || '').trim(); if (o.op === 'set_speaker' && !who) { failed.push('no speaker was given'); continue; }
      out[i] = { ...out[i], p: true, ...(who ? { sp: who } : {}) }; done.push(o.op === 'split' ? `new paragraph in ${o.para} at "${o.starts_with}"` : `paragraph ${o.para}${i !== p.i0 ? ` from "${o.starts_with}"` : ''} is now ${who}`);
    }
    else if (o.op === 'join_with_previous') { const q = paras[o.para - 1]; if (!q || p.note || q.note) { failed.push(`paragraph ${o.para} cannot be joined to the one before`); continue; } const { p: _p, sp, side, ...rest } = out[p.i0]; out[p.i0] = rest; done.push(`paragraph ${o.para} joined to ${o.para - 1}`); }
    else if (o.op === 'insert_line') {
      const text = String(o.text || '').trim(); if (!text) { failed.push('no text for the line'); continue; }
      let i = p.i0 + p.n - 1; if (o.after && String(o.after).trim()) { const e = findQuote(toks(), p.i0, p.i0 + p.n, o.after, true); if (e < 0) { failed.push(`the words "${o.after}" are not in paragraph ${o.para}`); continue; } i = e; }
      const s0 = out[i].e ?? out[i].s, note = text.split(/\s+/).map((t, j) => (j === 0 ? { t, s: s0, e: s0, p: true, lg: { k: 'n', auto: text, by: 'claude' } } : { t, s: s0, e: s0 }));
      const rest = out.slice(i + 1); if (rest.length && !rest[0].p) rest[0] = { ...rest[0], p: true, sp: speakerBefore(out, i) };
      out = out.slice(0, i + 1).concat(note, rest); done.push(`line put in after paragraph ${o.para}: ${text}`);
    }
    else if (o.op === 'remove_line') { if (!p.note) { failed.push(`paragraph ${o.para} is speech, not a line that can be removed`); continue; } out = out.slice(0, p.i0).concat(out.slice(p.i0 + p.n)); done.push(`line ${o.para} removed`); }
    else failed.push(`unknown change "${o.op}"`);
  }
  return { words: out, done: done.reverse(), failed };
}
