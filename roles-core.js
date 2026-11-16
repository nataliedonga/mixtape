/* Who is who, from the words alone. No model, nothing sent anywhere: plain rules about what is said in a hearing or an
   interview, each answer carrying the words it rests on. A speaker with mixed or thin evidence is left alone.

   - the court says "overruled", "sustained", "you may"; counsel says "objection", "your honor", "no further questions";
   - the one who keeps asking and the one who keeps answering straight after a question are the examiner and the witness;
   - a voice that says both the court's words and counsel's is two people heard as one: it is flagged, not named.

   Also: places where a legal transcript usually carries an insert (an exhibit, an oath, a recess, off the record).
   These are only pointed at. Nothing is inserted or renamed here; the page asks first. */
const low = t => ' ' + String(t).toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
const COURT = ['overruled', 'sustained', 'you may proceed', 'you may answer', 'you may step down', 'any objection', 'be seated', 'call your next witness', 'we are off the record', 'we are back on the record', 'the objection is'];
const COUNSEL = ['objection', 'your honor', 'your honour', 'my lord', 'my lady', 'no further questions', 'nothing further', 'into evidence', 'may i approach', 'pass the witness', 'move to strike'];
const QSTART = /^ (?:(?:and|so|okay|ok|now|well|um|uh|but|then|all right|alright) )*(?:do|did|does|are|is|was|were|have|has|had|can|could|would|will|what|what's|where|when|why|how|who|which|isn't|didn't|aren't|wasn't|weren't|don't|doesn't) /;
const QEND = / (?:right|correct|is that right|is that correct|isn't it|isn't that right|isn't that correct|is that fair) $/;

/* the transcript as turns: paragraphs by the same speaker, one after another, are one turn. Legal inserts are not speech. */
export function turns(words) {
  const out = []; let cur = null, sp = '';
  words.forEach((w, i) => {
    if (i === 0 || w.p) { if (w.lg) { cur = null; return; } sp = w.sp || sp; if (!cur || cur.sp !== sp) { cur = { i0: i, i1: i, sp, s: w.s, raw: [] }; out.push(cur); } }
    if (!cur || w.lg) return; cur.raw.push(w.t); cur.i1 = i + 1;
  });
  for (const t of out) { t.text = t.raw.join(' '); t.low = low(t.text); t.n = t.raw.length; delete t.raw; }
  return out.filter(t => t.n);
}
const TENS = /^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)$/, ONES = /^(one|two|three|four|five|six|seven|eight|nine)$/;
const asks = t => /\?\s*$/.test(t.text) || QSTART.test(t.low) || QEND.test(t.low);
const hits = (t, list) => list.filter(k => t.low.includes(' ' + k + ' '));

/* what the words show about each speaker: [{ label, role: 'court' | 'witness' | 'examiner' | 'mixed' | '', sure, evidence: [..], asks, answers }] */
export function roles(words) {
  const ts = turns(words), by = new Map();
  const of = sp => { if (!by.has(sp)) by.set(sp, { label: sp, turns: 0, court: [], counsel: [], asks: 0, answers: 0, first: null }); return by.get(sp); };
  ts.forEach((t, k) => {
    if (!t.sp) return; const o = of(t.sp); o.turns++; if (o.first == null) o.first = t.i0;
    for (const h of hits(t, COURT)) o.court.push({ say: h, s: t.s, i: t.i0 });
    for (const h of hits(t, COUNSEL)) o.counsel.push({ say: h, s: t.s, i: t.i0 });
    const q = asks(t); if (q) o.asks++;
    const prev = ts[k - 1]; if (prev && prev.sp && prev.sp !== t.sp && asks(prev) && t.n <= 25 && !q) o.answers++;
  });
  const out = [];
  for (const o of by.values()) {
    const c = o.court.length, l = o.counsel.length, q = o.asks, a = o.answers; let role = '', sure = false; const evidence = [];
    const said = list => [...new Set(list.map(x => `“${x.say}”`))].slice(0, 3).join(', ');
    if (c >= 2 && l >= 2) { role = 'mixed'; evidence.push(`says the court’s words (${said(o.court)}) and counsel’s (${said(o.counsel)})`); }
    else if (a >= 3 && a > q * 1.5 && c <= 1) { role = 'witness'; sure = a >= 6; evidence.push(`answers straight after a question ${a} times, asks ${q}`); }
    else if (q >= 3 && q > a * 1.5 && c <= 1) { role = 'examiner'; sure = q >= 6; evidence.push(`asks ${q} questions, answers ${a}`); if (l) evidence.push(`says ${said(o.counsel)}`); }
    else if (c >= 2 && !l) { role = 'court'; evidence.push(`says ${said(o.court)}`); }
    out.push({ label: o.label, role, sure, evidence, asks: q, answers: a, turns: o.turns, first: o.first, mixedAt: role === 'mixed' ? [...o.court, ...o.counsel].sort((x, y) => x.i - y.i).map(x => x.i) : [] });
  }
  // the witness's name, when the examiner greets them by it ("good afternoon, Ms Dlamini")
  const ex = out.filter(r => r.role === 'examiner').map(r => r.label), wit = out.filter(r => r.role === 'witness');
  if (wit.length === 1) for (const t of ts) { if (!ex.includes(t.sp)) continue; const m = / good (?:morning|afternoon|evening) (mr|ms|mrs|miss|dr) ([a-z]{2,}) /.exec(t.low); if (m) { wit[0].name = `${m[1].toUpperCase().replace('MISS', 'MS')}. ${m[2].toUpperCase()}`; wit[0].evidence.push(`the examiner greets the witness as “${m[1]} ${m[2]}”`); break; } }
  return out;
}

/* places that usually carry an insert in a legal transcript: [{ i, end, s, kind, say, text, quote }]
   (i, end: the turn's first and last word; text: the notation as it would stand in the transcript) */
export function inserts(words, style = '') {
  const out = [], seen = new Set();
  const add = (t, kind, say, m, text) => { const key = kind + '@' + t.i0; if (seen.has(key)) return; seen.add(key); const at = Math.max(0, m.index - 40); out.push({ i: t.i0, end: t.i1 - 1, s: t.s, kind, say, text, quote: t.low.slice(at, m.index + m[0].length + 40).trim() }); };
  for (const t of turns(words)) {
    let m;
    if ((m = / exhibit (?:number |no |num )?([a-z0-9]+(?: [a-z0-9]+)?) /.exec(t.low))) {
      const how = / into evidence | move | offer /.test(t.low) ? 'offered into evidence (check whether the court received it)' : / admitted | received /.test(t.low) ? 'received in evidence' : / mark(?:ed)? | identification /.test(t.low) ? 'marked for identification' : '';
      // the identifier is one word, or two when they belong together: "twenty five", "one hundred", "12 a"
      const [w1, w2] = m[1].split(' '), id = w2 && ((TENS.test(w1) && ONES.test(w2)) || (ONES.test(w1) && w2 === 'hundred') || /^[a-z]$/.test(w2)) ? `${w1} ${w2}` : w1;
      if (how) add(t, 'exhibit', `Exhibit ${id}: ${how}`, m, `(Exhibit ${id} ${how.replace(/ \(.*$/, '')}.)`);
    }
    if ((m = / (?:solemnly )?(?:swear|affirm) /.exec(t.low)) && / truth | testimony /.test(t.low)) add(t, 'oath', 'A witness is sworn or affirmed here', m, '(Witness sworn.)');
    if ((m = / (?:take|taking|stand in|be in) (?:a |an |our |the )?(?:short |brief |lunch |ten minute |five minute |fifteen minute )?(?:recess|break) /.exec(t.low))) add(t, 'recess', 'A recess is taken here', m, '(Recess taken.)');
    if ((m = / (?:go|going|we are|we're) off the record /.exec(t.low))) add(t, 'off', 'Off the record from here', m, '(Discussion off the record.)');
    if ((m = / back on the record /.exec(t.low))) add(t, 'on', 'Back on the record here', m, '(Back on the record.)');
  }
  return style === 'rev' ? out.map(revNotation) : out;
}
/* Rev's legal guide has its own wording, and only for some of these: an exhibit marked or received (digits for the
   number), and a recess. Where it has none (an exhibit only offered, an oath, back on the record) the notation is
   empty, so the place is pointed at and nothing is put in. */
const NUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
export const digits = id => { const p = String(id).split(' '); if (p.every(w => w in NUM)) { const n = p.length === 2 ? (NUM[p[0]] >= 20 && NUM[p[1]] < 10 ? NUM[p[0]] + NUM[p[1]] : null) : NUM[p[0]]; if (n != null) return String(n); } return p.length === 2 && /^[a-z]$/.test(p[1]) ? (p[0] in NUM ? NUM[p[0]] : p[0]) + p[1].toUpperCase() : /^[a-z]$/.test(id) ? id.toUpperCase() : id; };
function revNotation(x) {
  if (x.kind === 'exhibit') { const m = /^Exhibit (.+?): (.*)$/.exec(x.say) || [], id = digits(m[1] || ''), how = m[2] || '';
    return { ...x, say: `Exhibit ${id}: ${how}`, text: /^marked/.test(how) ? `(Exhibit ${id} was marked for identification.)` : /^received/.test(how) ? `(Exhibit ${id} was received into evidence.)` : '' }; }
  if (x.kind === 'recess' || x.kind === 'off') return { ...x, text: '(A recess was taken.)' };
  return { ...x, text: '' };
}
/* Reverb sometimes writes two forms of one word as a single word: the full form and the one that was said ("will" and
   "'ll" as "willll", "because" and "'cause" as "becausecause", "seven" and "7" as "seven7"), or a false start and the
   word ("turnturnover", "preservpreserve-"). These three shapes are repaired; anything less certain is left alone.
   Returns { words, fixed: [{ i, from, to }] }; each repaired word keeps what Reverb wrote in w.o, so it can be put back. */
const TAILS = { will: ['ll'], would: ['d'], had: ['d'], has: ['s'], is: ['s'], have: ['ve'], are: ['re'], am: ['m'], them: ['em'], because: ['cause'], not: ['nt'] };
const NUMS = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
export function unglue(words) {
  const seen = new Map(); for (const w of words) { const b = String(w.t).toLowerCase().replace(/[^a-z]/g, ''); if (b) seen.set(b, (seen.get(b) || 0) + 1); }
  const fixed = [], out = words.map((w, i) => {
    if (w.lg || w.o) return w;
    const m = /^([("']*)(.*?)([-.,?!;:)"']*)$/.exec(String(w.t)), core = m[2], low = core.toLowerCase(), flat = low.replace(/'/g, ''); let to = '';
    for (const [full, tails] of Object.entries(TAILS)) for (const t of tails) if (flat === full + t) to = core.slice(0, full.length);
    const n = /^([a-z]+)(\d+)$/.exec(low); if (!to && n && NUMS[n[1]] === n[2]) to = core.slice(0, n[1].length);
    if (!to) for (let k = 3; k <= flat.length - 4; k++) { const A = low.slice(0, k), B = low.slice(k); if (B.length > A.length && B.startsWith(A) && /^[a-z]+$/.test(A) && (seen.get(flat) || 0) <= 1 && (seen.has(B.replace(/[^a-z]/g, '')) || seen.has(A))) { to = core.slice(k); break; } }
    if (!to || to.toLowerCase() === low) return w;
    if (/^[A-Z]/.test(core) && /^[a-z]/.test(to)) to = to[0].toUpperCase() + to.slice(1);
    const t = m[1] + to + m[3]; fixed.push({ i, from: w.t, to: t }); return { ...w, t, o: w.t };
  });
  return { words: out, fixed };
}
export const suggest = (words, style = '') => ({ roles: roles(words), inserts: inserts(words, style) });
