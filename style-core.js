/* What a style asks of the words in a saved file, beyond tags: how numbers are written, which informal forms are
   written out, and how a cut-off word or a trailing-off is marked. Only for files: the transcript keeps what was heard.

   Rev's legal guide (the only style whose rules for these were found):
   - a number that says "which one" is in digits, with its word in capitals: Exhibit 5, Page 15, Paragraph 3, Line 6;
   - a number that says "how many" is in words from zero to ten and in digits from 11, but in words at the start of a
     sentence; indefinite amounts ("a hundred times") stay in words;
   - money in digits with a dollar sign when "dollars" is said ($42, $1,000); "percent" as a word after digits;
   - years in digits (1995, 2006, 2022);
   - gonna, kinda, gotta, 'cause, 'em, coulda and the like are written out; ordinary contractions are left;
   - no ellipses, no exclamation marks, and a spaced double dash for a cut-off or a trailing-off.
   TranscribeMe full verbatim: "them" in full for "'em"; a double dash straight after a cut-off word.
   Dates, clock times, fractions and measurements are left as heard: the rules need more than the words to apply. */
const ONES = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const BIG = { hundred: 100, thousand: 1000, million: 1000000 };
const WHICH = { exhibit: 'Exhibit', exhibits: 'Exhibits', page: 'Page', pages: 'Pages', paragraph: 'Paragraph', paragraphs: 'Paragraphs', line: 'Line', lines: 'Lines', tab: 'Tab', tabs: 'Tabs', grade: 'grade', unit: 'unit', number: 'Number' };
const FORMS = { gonna: 'going to', gotta: 'got to', kinda: 'kind of', gotcha: 'got you', coulda: 'could have', woulda: 'would have', shoulda: 'should have', "'cause": 'because', "'em": 'them', "'til": 'until' };
const bare = t => String(t).toLowerCase().replace(/^[("'\[]+(?=[a-z0-9])|[)"\].,?!;:]+$/g, '');
const tail = t => (/([)"\]]*[.,?!;:]+)$/.exec(String(t)) || ['', ''])[1];
const isNum = b => b in ONES || b in TEENS || b in TENS || b in BIG;
const sub100 = (a, b) => (a in TENS ? (b in ONES && ONES[b] > 0 ? [TENS[a] + ONES[b], 2] : [TENS[a], 1]) : a in TEENS ? [TEENS[a], 1] : a in ONES ? [ONES[a], 1] : null);

/* a number spoken as words, starting at toks[i] (bare words): { value, n, year } or null */
export function number(toks, i) {
  const a = toks[i], b = toks[i + 1], c = toks[i + 2];
  if (!isNum(a) || a in BIG) return null;
  // a year said as two pairs: "nineteen ninety five", "twenty twenty two", "nineteen oh six"
  if ((a in TEENS || a in TENS) && b && (b in TENS || b in TEENS || (b === 'oh' && c in ONES))) {
    const first = sub100(a), rest = b === 'oh' ? [ONES[c], 2] : sub100(b, c);
    if (first && first[1] === 1 && first[0] >= 10 && rest) return { value: first[0] * 100 + rest[0], n: 1 + rest[1], year: true };
  }
  let k = i, total = 0, cur = 0, any = false;
  for (;;) {
    const s = sub100(toks[k], toks[k + 1]);
    if (s) { cur += s[0]; k += s[1]; any = true; } else if (!any) return null;
    const m = toks[k];
    if (m === 'hundred' && cur > 0 && cur < 100) { cur *= 100; k++; if (toks[k] === 'and' && sub100(toks[k + 1], toks[k + 2])) k++; const t = sub100(toks[k], toks[k + 1]); if (t) { cur += t[0]; k += t[1]; } }
    const g = toks[k];
    if ((g === 'thousand' || g === 'million') && cur > 0) { total += cur * BIG[g]; cur = 0; k++; if (toks[k] === 'and' && sub100(toks[k + 1], toks[k + 2])) k++; if (sub100(toks[k], toks[k + 1])) { any = false; continue; } }
    break;
  }
  const value = total + cur, year = value >= 1900 && value <= 2099 && toks.slice(i, k).includes('thousand') && !toks.slice(i, k).includes('hundred'); // "two thousand and six"
  return { value, n: k - i, year };
}
const commas = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/* the words of a file in the style's own way. A copy: the transcript is not touched. */
export function styled(words, style = '') {
  if (style !== 'rev' && style !== 'tm-full' && style !== 'tm-clean') return words;
  const out = []; let i = 0;
  const startsSentence = k => k === 0 || words[k].p || /[.?!]["')\]]*$/.test(words[k - 1].t);
  while (i < words.length) {
    const w = words[i], b = bare(w.t), end = tail(w.t);
    if (w.lg || w.tagged || w.quiet) { out.push(w); i++; continue; }
    if (style === 'rev') {
      // a run of number words inside one paragraph, not broken by a mark
      let j = i; const toks = []; while (j < words.length && (j === i || !words[j].p) && !words[j].lg && !words[j].tagged) { toks.push(bare(words[j].t)); if (tail(words[j].t)) break; j++; }
      const num = number(toks, 0);
      if (num && !(out.length && bare(out[out.length - 1].t) === 'a' && toks[0] in BIG)) {
        const last = words[i + num.n - 1], after = words[i + num.n], prev = out[out.length - 1], pb = prev ? bare(prev.t) : '', nb = after && !after.p && !tail(last.t) ? bare(after.t) : '';
        const which = pb in WHICH && !tail(prev.t), money = nb === 'dollars' || nb === 'dollar', pct = nb === 'percent';
        const digits = which || money || pct || num.year || (num.value >= 11 && !startsSentence(i));
        if (digits) {
          if (which) out[out.length - 1] = { ...prev, t: prev.t.replace(/[a-z]+/i, m => (WHICH[pb][0] === WHICH[pb][0].toUpperCase() ? m[0].toUpperCase() + m.slice(1) : m)) };
          const text = money ? '$' + commas(num.value) : which || num.year ? String(num.value) : commas(num.value);
          out.push({ ...w, t: text + (money ? tail(after.t) : tail(last.t)), e: (money ? after : last).e ?? w.e }); i += num.n + (money ? 1 : 0); continue;
        }
      }
      const f = FORMS[b] || FORMS[String(w.t).toLowerCase().replace(/[.,?!;:]+$/, '')];
      if (f) { const cap = /^['"(]*[A-Z]/.test(w.t); out.push({ ...w, t: (cap ? f[0].toUpperCase() + f.slice(1) : f) + end }); i++; continue; }
      let t = w.t.replace(/(\.\.\.|…)$/, ' --').replace(/!+$/, '.');
      if (/[a-z]-$/i.test(t)) t = t.slice(0, -1) + ' --';
      out.push(t === w.t ? w : { ...w, t }); i++; continue;
    }
    let t = w.t;
    if (style === 'tm-full' && String(t).toLowerCase().replace(/[.,?!;:]+$/, '') === "'em") t = (/^'E/.test(t) ? 'Them' : 'them') + end;
    if (/[a-z]-$/i.test(t)) t = t + '-';
    out.push(t === w.t ? w : { ...w, t }); i++;
  }
  return out;
}
