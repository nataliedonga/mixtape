/* Tags in a transcript, in the wording of the style in use.

   A tag is a mark on words that were heard, never a replacement for them: the transcript keeps what the recogniser
   wrote, and the tag decides what is shown and saved in its place.
     w.tg  'inaudible' | 'guess' | 'crosstalk'   on a word (or a run of words in one paragraph): shown instead of it
     w.ta  ['laughter', 'foreign', 'music', 'applause', 'sic', 'noresponse']   after a word: something that is not speech
   Each style has its own approved set and wording (Rev's legal guide; TranscribeMe's tag list); where a style has no
   such tag, the heard words stand and nothing is added. Silence of ten seconds or more can be marked when a file is
   saved (TranscribeMe's rule), and words the recogniser was unsure of can be saved as guesses. */
import { styled } from './style-core.js';
const pad = n => String(n).padStart(2, '0');
export const clock = t => { t = Math.max(0, Math.floor(t || 0)); return `${pad(Math.floor(t / 3600))}:${pad(Math.floor(t / 60) % 60)}:${pad(t % 60)}`; };
const strip = t => String(t).replace(/^[("'\[]+|[)"'\].,?!;:]+$/g, '');
const tail = t => (/([.,?!;:]+)$/.exec(String(t)) || ['', ''])[1];

/* what stands in place of a tagged run (words: the run, in order). '' = the style has no such tag: the words stand. */
export function instead(kind, words, style = '') {
  const end = tail(words[words.length - 1].t), said = words.map((w, k) => (k === words.length - 1 ? strip(w.t) : w.t)).join(' ');
  if (kind === 'inaudible') return (style === 'rev' ? `[inaudible ${clock(words[0].s)}]` : '[inaudible]') + end;
  if (kind === 'guess') return (style === 'rev' ? `${said} (phonetic)` : `[${said}?]`) + end;
  if (kind === 'crosstalk') return style === 'rev' ? '' : '[crosstalk]' + end;
  return '';
}
/* what is written after a word for each thing that is not speech ('' = this style leaves it out) */
export function after(kind, style = '') {
  const rev = style === 'rev';
  return { laughter: rev ? '' : '[laughter]', music: rev ? '' : '[music]', applause: rev ? '' : '[applause]', foreign: rev ? '(foreign language spoken)' : '[foreign]',
    sic: rev ? '(sic)' : '', noresponse: rev ? '(No audible response)' : '[no audible response]' }[kind] || '';
}
/* the tags a style offers: [kind, label on the button, what it is for, 'on' (stands for words) or 'after'] */
export function offered(style = '') {
  const on = [['inaudible', instead('inaudible', [{ t: 'x', s: 0 }], style).replace('00:00:00', 'time'), 'Words that cannot be made out', 'on'],
    ['guess', style === 'rev' ? '(phonetic)' : '[word?]', style === 'rev' ? 'A name or word spelled by ear, not verified' : 'A word you are not sure of: kept, and marked as a guess', 'on']];
  if (style !== 'rev') on.push(['crosstalk', '[crosstalk]', 'Someone talks over the speaker and the words are lost', 'on']);
  const aft = ['laughter', 'foreign', 'music', 'applause', 'sic', 'noresponse'].map(k => [k, after(k, style), { laughter: 'Laughter, after this word', foreign: 'Speech in another language, after this word', music: 'Music, after this word', applause: 'Applause, after this word', sic: 'The speaker’s own slip, written as said', noresponse: 'Nothing was said in answer' }[k], 'after']).filter(x => x[1]);
  return on.concat(aft);
}
/* The words as they are shown and saved: a tagged run becomes one word carrying the tag's text, things that are not
   speech follow their word, and (opts) long silences and unsure words are marked. The transcript is not touched: this
   returns a copy. opts: { silence: seconds or 0, unsure: confidence below which a word is saved as a guess, or 0 } */
export function render(words, style = '', opts = {}) { const r = tagged(words, style, opts); return opts.file ? styled(r, style) : r; } // opts.file: for a saved file, the style's numbers and forms too (style-core.js)
function tagged(words, style, opts) {
  const out = []; let i = 0;
  const push = (w, src) => { if ((src.p || src._p) && !w.p) { w = { ...w, p: true }; if (src.sp) w.sp = src.sp; } out.push(w); };
  while (i < words.length) {
    const w = words[i]; let run = null;
    if (w.lg) { out.push(w); i++; continue; }
    const kind = w.tg || (opts.unsure && w.c != null && w.c < opts.unsure && style !== 'rev' ? 'guess' : '');
    if (kind) { let j = i + 1; while (j < words.length && !words[j].p && !words[j].lg && words[j].tg === w.tg && w.tg && !(words[j - 1].ta || []).length) j++; run = words.slice(i, j); }
    let piece;
    if (run) { const text = instead(kind, run, style); if (text) { piece = { ...run[0], t: text, e: run[run.length - 1].e ?? run[0].e, tagged: kind }; delete piece.tg; } }
    const group = run && piece ? run : [w], lastW = group[group.length - 1];
    if (!piece) { for (const x of group) push({ ...x }, x); }
    else push(piece, run[0]);
    const extra = (lastW.ta || []).map(k => after(k, style)).filter(Boolean);
    if (extra.length) { const k = out.length - 1, t = out[k].t, e = tail(t); out[k] = { ...out[k], t: (e ? t.slice(0, -e.length) : t) + ' ' + extra.join(' ') + e }; }
    i += group.length;
  }
  if (opts.silence && style !== 'rev') { // ten seconds of nothing: a line of its own, and what follows starts a new paragraph
    const res = []; let sp = '';
    out.forEach((w, k) => {
      const prev = out[k - 1]; if (w.p && w.sp) sp = w.sp;
      if (prev && !w.lg && !prev.lg && w.s != null && prev.e != null && w.s - prev.e >= opts.silence) { res.push({ t: '[silence]', s: prev.e, e: w.s, p: true, quiet: true }); res.push(w.p ? w : { ...w, p: true, ...(sp ? { sp } : {}) }); }
      else res.push(w);
    });
    return res;
  }
  return out;
}
/* marking: toggles a tag on words i0..i1 (in one go: all on, or if all had it already, all off). Returns new words. */
export function mark(words, i0, i1, kind) {
  const where = kind === 'inaudible' || kind === 'guess' || kind === 'crosstalk' ? 'on' : 'after';
  if (where === 'on') { const all = words.slice(i0, i1 + 1).every(w => w.tg === kind); return words.map((w, i) => { if (i < i0 || i > i1 || w.lg) return w; const n = { ...w }; if (all) delete n.tg; else n.tg = kind; return n; }); }
  return words.map((w, i) => { if (i !== i1 || w.lg) return w; const n = { ...w }, ta = new Set(n.ta || []); if (ta.has(kind)) ta.delete(kind); else ta.add(kind); if (ta.size) n.ta = [...ta]; else delete n.ta; return n; });
}
