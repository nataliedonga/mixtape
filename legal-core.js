/* Mixtape legal transcript inserts: the rules, with no page and no audio (checked by node legal-check.cjs).
   A legal mark lives on a word of the transcript as `lg`:
     on a paragraph's first word   { k: 'n', id }            a notation on its own line (parenthetical, heading, event)
                                   { k: 'q' } / { k: 'a' }   a question / an answer
       with  x: { party, n, n2, desc, ev }   an exhibit event      w: { name, party, oath }   a witness event
             ex: { type, by }                an examination starts here       at: seconds in the recording
     on a word inside a paragraph  { k: 'i', id, len, x }    an event written into the running text (len words long)
   Everything else about the transcript (words, times, paragraphs, speakers) is TranscriptCore's.
   Loaded as a classic script (window.LegalCore) after transcript-core.js and legal-presets.js, and by Node. */
(function (root) {
  const T = root.TranscriptCore, P = root.LegalPresets;
  const CAT = new Map(P.CATALOG.map(c => [c.id, c]));
  const pad = n => String(n).padStart(2, '0');

  /* ---- presets: a preset with everything it inherits, and the person's own wording and codes on top ---- */
  function preset(id, user) {
    const chain = []; let p = P.PRESETS[id] || P.PRESETS[P.DEFAULT], guard = 0; id = P.PRESETS[id] ? id : P.DEFAULT;
    while (p && guard++ < 8) { chain.unshift(p); p = p.base ? P.PRESETS[p.base] : null; }
    const out = { id, wording: {} };
    for (const c of chain) { for (const k of Object.keys(c)) if (k !== 'wording' && k !== 'base') out[k] = c[k]; Object.assign(out.wording, c.wording || {}); }
    out.unsourced = new Set(out.unsourced || []);
    const mine = user && user.wording && user.wording[id]; out.edited = new Set();
    if (mine) for (const k of Object.keys(mine)) { out.wording[k] = mine[k]; out.edited.add(k); }
    out.codes = Object.assign({}, user && user.codes);
    return out;
  }
  /* the inserts that exist in a preset, each with its wording and its short code */
  function inserts(pre) {
    const out = [];
    for (const c of P.CATALOG) {
      const tpl = c.kind === 'sp' ? pre.roles[c.role] : pre.wording[c.as || c.id];
      if (tpl == null) continue;
      out.push(Object.assign({}, c, { tpl, code: pre.codes[c.id] || c.code, unsourced: pre.unsourced.has(c.as || c.id), edited: pre.edited.has(c.as || c.id) }));
    }
    return out;
  }
  const byCode = list => new Map(list.map(x => [x.code.toLowerCase(), x]));

  /* ---- wording: templates filled with values that were asked for ---- */
  const KEYS = /\{(\w+)\}/g;
  function fields(tpl) { const out = []; for (const m of String(tpl).matchAll(KEYS)) { const k = m[1].toLowerCase(); if (k !== 'time' && !out.includes(k)) out.push(k); } return out; }
  function fill(tpl, vals, blank = '___') {
    const val = k => { const up = k !== k.toLowerCase(), v = String((vals || {})[k.toLowerCase()] ?? '').trim(); return up ? v.toUpperCase() : v; };
    const sub = s => s.replace(KEYS, (_, k) => val(k) || blank);
    return sub(String(tpl).replace(/\[\[((?:(?!\[\[)[\s\S])*?)\]\](?!\])/g, (_, seg) => ([...seg.matchAll(KEYS)].every(m => val(m[1])) ? sub(seg) : ''))).replace(/ {2,}/g, ' ').trim();
  }
  /* how an insert reads in the list, before any value is known */
  const sample = tpl => fill(tpl, { time: '00:00:00', n: '#', n2: '#', name: 'Name', by: 'Mr. Name', clock: 'time', date: 'date', reason: 'reason', what: 'document', desc: '', party: '' }, '…');
  function fmtTime(sec, form) { const s = Math.max(0, Math.floor(sec || 0)); return form === 'ms' ? `${pad(Math.floor(s / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; }
  /* a time of day worked out from when the recording began ("9:44 am" + 1h30 of sound); '' when that is not known */
  function clockAt(start, sec) {
    const m = /^\s*(\d{1,2})[:.h](\d{2})\s*([ap])?\.?\s*(m)?\.?\s*$/i.exec(start || ''); if (!m) return '';
    let h = +m[1]; const ap = (m[3] || '').toLowerCase(); if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
    const tot = (h * 60 + +m[2] + Math.floor((sec || 0) / 60)) % 1440, H = Math.floor(tot / 60), M = tot % 60;
    return ap ? `${H % 12 || 12}:${pad(M)} ${H < 12 ? 'a.m.' : 'p.m.'}` : `${pad(H)}:${pad(M)}`;
  }

  /* ---- short codes typed in the correction box ---- */
  /* the ;code that ends just before the caret, when it does not sit inside a word ("a;b" is not a code) */
  function codeAt(text, caret) {
    const m = /(^|[\s(\[“"'])(;[a-z0-9]{1,6})$/i.exec(String(text).slice(0, caret)); if (!m) return null;
    return { start: m.index + m[1].length, code: m[2].slice(1).toLowerCase() };
  }

  /* ---- speakers ---- */
  const roleLabel = (pre, legal, role) => ((legal && legal.roles && legal.roles[role]) || pre.roles[role] || '').trim();
  const personLabel = (pre, p) => `${pre.titles[p.title] ?? (p.title || '')} ${String(p.name || '').toUpperCase()}`.trim();
  /* the nine speaker slots: the preset's fixed roles first, then the appearances */
  function slots(pre, legal) {
    const out = pre.fixed.map(r => ({ label: roleLabel(pre, legal, r), role: r, what: (CAT.get(r) || {}).name || r }));
    for (const p of (legal && legal.people) || []) if (p && String(p.name || '').trim()) out.push({ label: personLabel(pre, p), person: p, what: p.party ? `for ${p.party}` : 'Attorney' });
    return out.slice(0, 9).map((s, k) => Object.assign(s, { n: k + 1 }));
  }
  /* an examining attorney as typed: a slot number, "mr smith", or a name as it should stand */
  function resolveBy(pre, legal, v) {
    v = String(v || '').trim(); if (!v) return '';
    if (/^[1-9]$/.test(v)) { const s = slots(pre, legal)[+v - 1]; return s ? s.label : ''; }
    const m = /^(mr|ms|mrs|dr|adv)\.?\s+(.+)$/i.exec(v); if (m) return personLabel(pre, { title: m[1].toUpperCase().replace('MRS', 'MS'), name: m[2] });
    return v.toUpperCase();
  }

  /* ---- exhibits ---- */
  /* the identifier after this one in its series: 3 → 4, A → B, G(10) → G(11), P-9 → P-10, 1B → 1C. '' when there is no pattern */
  function nextId(id) {
    id = String(id || '').trim(); let m;
    if ((m = /^(.*\d)([A-Za-z])$/.exec(id))) return m[2] === 'Z' || m[2] === 'z' ? '' : m[1] + String.fromCharCode(m[2].charCodeAt(0) + 1);
    if ((m = /^(.*?)(\d+)(\D*)$/.exec(id))) return m[1] + String(+m[2] + 1).padStart(m[2].length, '0') + m[3];
    if ((m = /^([A-Za-z]+)$/.exec(id))) {
      const up = id === id.toUpperCase(), s = id.toUpperCase().split(''); let k = s.length - 1;
      while (k >= 0) { if (s[k] === 'Z') { s[k] = 'A'; k--; } else { s[k] = String.fromCharCode(s[k].charCodeAt(0) + 1); break; } }
      if (k < 0) s.unshift('A'); return up ? s.join('') : s.join('').toLowerCase();
    }
    return '';
  }
  const heads = words => { const out = []; words.forEach((w, i) => { if (i === 0 || w.p) out.push(i); }); return out; };
  const headOf = (words, i) => { let k = Math.max(0, Math.min(i, words.length - 1)); while (k > 0 && !words[k].p) k--; return k; };
  const paraEnd = (words, i) => { let k = i + 1; while (k < words.length && !words[k].p) k++; return k; };
  const same = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
  /* every exhibit, witness and examination event, in order: the indexes are made from these and from nothing else */
  function events(words) {
    const ex = [], wit = [], loose = []; let para = -1, cur = null;
    words.forEach((w, i) => {
      if (i === 0 || w.p) para++;
      const g = w.lg; if (!g) return;
      const at = g.at != null ? g.at : (w.s || 0), c = CAT.get(g.id) || {};
      if (g.x) ex.push(Object.assign({ i, para, at, id: g.id, hand: !!g.hand }, g.x));
      if (g.w) { cur = Object.assign({ i, para, at, id: g.id, exams: [], hand: !!g.hand }, g.w); wit.push(cur); }
      else if (c.ends === 'witness') cur = null;
      if (g.ex) { const e = { i, para, at, type: g.ex.type, by: g.ex.by || '', col: (CAT.get(g.ex.type) || {}).col || g.ex.type }; (cur ? cur.exams : loose).push(e); }
    });
    return { exhibits: ex, witnesses: wit, loose };
  }
  /* one row per exhibit: where it was marked, where it was received, and anything else that happened to it */
  function exhibitRows(evs) {
    const rows = new Map();
    for (const e of evs.exhibits) {
      const ids = e.n2 && nextId(e.n) ? (() => { const out = [e.n]; let k = e.n, g = 0; while (!same(k, e.n2) && g++ < 200) { k = nextId(k); if (!k) break; out.push(k); } return same(out[out.length - 1], e.n2) ? out : [e.n, e.n2]; })() : [e.n];
      for (const n of ids) {
        const key = `${String(e.party || '').toLowerCase()}|${String(n).toLowerCase()}`; let r = rows.get(key);
        if (!r) { r = { party: e.party || '', n, desc: '', marked: null, received: null, other: [] }; rows.set(key, r); }
        if (e.desc && !r.desc) r.desc = e.desc;
        if (/marked/.test(e.ev) && e.ev !== 'previously marked' && !r.marked) r.marked = e;
        if (/received/.test(e.ev) && !r.received) r.received = e;
        if (!/^(marked|received|marked and received)$/.test(e.ev)) r.other.push(e);
      }
    }
    return [...rows.values()];
  }
  /* what to offer for the next exhibit event: never applied, always shown and changeable */
  function proposeExhibit(evs, ev, party) {
    const rows = exhibitRows(evs), mine = rows.filter(r => same(r.party, party));
    if (ev === 'marked' || ev === 'marked and received') { const last = mine.filter(r => r.marked).pop(); return { party: party || '', n: last ? nextId(last.n) : '' }; }
    if (ev === 'received') { const open = rows.filter(r => r.marked && !r.received && (!party || same(r.party, party))).pop(); return open ? { party: open.party, n: open.n } : { party: party || '', n: '' }; }
    const last = rows[rows.length - 1]; return last ? { party: party || last.party, n: last.n } : { party: party || '', n: '' };
  }
  /* the event that already marked this exhibit, if any (an exhibit is marked once) */
  const alreadyMarked = (evs, party, n) => { const r = exhibitRows(evs).find(r => same(r.party, party) && same(r.n, n)); return r && r.marked ? r.marked : null; };

  /* ---- putting an insert into the words ---- */
  const toks = text => String(text).trim().split(/\s+/).filter(Boolean);
  const stamp = (prev, next, at) => { const lo = prev ? (prev.e ?? prev.s) : null, hi = next ? next.s : null; if (lo == null && hi == null) return at ?? 0; let s = at ?? lo ?? hi; if (lo != null) s = Math.max(lo, s); if (hi != null) s = Math.min(Math.max(hi, lo ?? hi), s); return +(+s).toFixed(3); };
  /* a notation paragraph after the paragraph that holds word i (i = -1: before everything) */
  function insertBlock(words, i, text, lg, at) {
    const j = i < 0 || !words.length ? 0 : paraEnd(words, headOf(words, i)), s = stamp(words[j - 1], words[j], at);
    const neu = toks(text).map((t, k) => (k === 0 ? { t, s, e: s, p: true, lg: Object.assign({}, lg, at != null ? { at: +(+at).toFixed(3) } : {}) } : { t, s, e: s }));
    const rest = words.slice(j); if (rest.length && !rest[0].p) rest[0] = Object.assign({}, rest[0], { p: true });
    return { words: words.slice(0, j).concat(neu, rest), at: j, n: neu.length };
  }
  /* words written into the running text straight after word i */
  function insertInline(words, i, text, lg, at) {
    if (i < 0 || !words.length) { const r = insertBlock(words, -1, text, null, at); r.words[r.at] = Object.assign({}, r.words[r.at]); delete r.words[r.at].lg; if (lg) r.words[r.at].lg = lg; return r; }
    const s = stamp(words[i], words[i + 1] && !words[i + 1].p ? words[i + 1] : null, at), tk = toks(text);
    const neu = tk.map((t, k) => (k === 0 && lg ? { t, s, e: s, lg: Object.assign({ k: 'i', len: tk.length }, lg, at != null ? { at: +(+at).toFixed(3) } : {}) } : { t, s, e: s }));
    return { words: words.slice(0, i + 1).concat(neu, words.slice(i + 1)), at: i + 1, n: neu.length };
  }

  /* ---- examinations: questions and answers ---- */
  const kind = w => (w && w.lg && (w.lg.k === 'n' || w.lg.k === 'q' || w.lg.k === 'a') ? w.lg.k : 'c');
  const closes = w => { const g = w && w.lg; if (!g) return false; return !!g.w || !!(CAT.get(g.id) || {}).ends; };
  /* the examination that word i is inside: { type, by, head } or null */
  function examAt(words, i) {
    if (!words.length) return null;
    for (let k = headOf(words, i); k >= 0; k--) { const w = words[k]; if (k !== 0 && !w.p) continue; if (w.lg && w.lg.ex) return Object.assign({ head: k }, w.lg.ex); if (closes(w)) return null; }
    return null;
  }
  /* where the examination that starts at paragraph `head` stops: the next examination, witness event or the end */
  function examEnd(words, head) { for (let k = paraEnd(words, head); k < words.length; k++) if (words[k].p && ((words[k].lg && words[k].lg.ex) || closes(words[k]))) return k; return words.length; }
  const mark = (w, k, sp) => { const o = Object.assign({}, w, { lg: Object.assign({}, w.lg, { k }) }); if (sp) o.sp = sp; return o; };
  /* Questions and answers PROPOSED for the paragraphs of an examination (the person corrects any that are wrong).
     Paragraphs already marked keep their mark. Where the recogniser told two voices apart, the first voice asks and the
     second answers and anyone else is left as colloquy; otherwise they alternate, starting again with a question after
     any notation or colloquy, and a paragraph that already has a speaker's name keeps it. */
  function flowQA(words, head, by, witness) {
    const out = words.slice(), end = examEnd(words, head), hs = heads(words).filter(h => h >= head && h < end && kind(words[h]) !== 'n');
    const voices = []; for (const h of hs) { const sp = words[h].sp; if (sp && kind(words[h]) === 'c' && !voices.includes(sp)) voices.push(sp); }
    const named = voices.length >= 2 && hs.every(h => words[h].sp || kind(words[h]) !== 'c');
    let next = 'q', prevHead = -1;
    for (const h of hs) {
      const w = out[h]; let k = kind(w);
      if (prevHead >= 0) for (let g = paraEnd(words, prevHead); g < h; g++) if (words[g].p && kind(words[g]) === 'n') next = 'q';
      if (k === 'c') { if (named) k = w.sp === voices[0] ? 'q' : w.sp === voices[1] ? 'a' : 'c'; else k = !w.sp ? next : w.sp === by ? 'q' : w.sp === witness ? 'a' : 'c'; } // a speaker somebody named stays as named
      if (k === 'c') { next = 'q'; prevHead = h; continue; }
      out[h] = mark(w, k, k === 'q' ? by : witness); next = k === 'q' ? 'a' : 'q'; prevHead = h;
    }
    return out;
  }
  /* one paragraph set to a question, an answer or colloquy ('c'); `following` flips every question and answer after it
     in the same examination as well (for when the alternation slipped by one) */
  function setQA(words, i, k, by, witness, following) {
    const out = words.slice(), h = headOf(words, i), ex = examAt(words, h), end = ex ? examEnd(words, ex.head) : paraEnd(words, h);
    const put = (g, kk) => { const w = out[g]; if (kk === 'c') { const lg = Object.assign({}, w.lg); delete lg.k; out[g] = Object.assign({}, w); if (Object.keys(lg).length) out[g].lg = lg; else delete out[g].lg; } else out[g] = mark(w, kk, kk === 'q' ? by : witness); };
    put(h, k);
    if (following && k !== 'c') for (let g = paraEnd(words, h); g < end; g++) if (words[g].p && (kind(words[g]) === 'q' || kind(words[g]) === 'a')) put(g, kind(words[g]) === 'q' ? 'a' : 'q');
    return out;
  }
  /* the two rules, as warnings: an answer only follows a question; an examination resumes with a question */
  function warnings(words) {
    const out = new Map(); let prev = '', ex = null;
    for (const h of heads(words)) {
      const w = words[h], k = kind(w);
      if (w.lg && w.lg.ex) ex = w.lg.ex; else if (closes(w)) ex = null;
      if ((k === 'q' || k === 'a') && !ex) out.set(h, 'This is marked as a question or an answer, but no examination has started above it.');
      else if (k === 'a' && prev !== 'q') out.set(h, prev === 'a' ? 'An answer follows an answer: an answer only follows a question.' : 'After an interruption an examination resumes with a question, not an answer.');
      prev = k;
    }
    return out;
  }

  /* ---- a paragraph corrected by hand: the legal marks stay with their words ----
     `neu` is what TranscriptCore.editParagraph made of words i0..i1. ctx: { on, pending: [{ txt, lg }], labels: [..],
     witness } - pending are inserts typed into the box (a notation line is matched by its exact text), labels are the
     speaker labels that may open a paragraph as "THE COURT: ...". */
  function edited(old, i0, i1, neu, ctx) {
    ctx = ctx || {}; const end = i1 + (neu.length - old.length); if (end <= i0) return neu;
    const head = old[i0] || {}, mid = neu.slice(i0, end), chunks = []; mid.forEach((w, k) => { if (k === 0 || w.p) chunks.push([]); chunks[chunks.length - 1].push(Object.assign({}, w)); });
    const ex = examAt(old, i0), labels = (ctx.labels || []).filter(Boolean).sort((a, b) => b.length - a.length), pend = (ctx.pending || []).filter(p => !p.used);
    const headLg = head.lg && head.lg.k !== 'i' ? head.lg : null;
    let last = null, broke = false; // the last spoken chunk, and whether a notation came after it
    chunks.forEach((ch, ci) => {
      const text = ch.map(w => w.t).join(' '), p = pend.find(x => !x.used && x.lg.k !== 'i' && x.txt === text);
      const setLg = lg => { if (lg) ch[0].lg = lg; else delete ch[0].lg; };
      if (p) { p.used = true; setLg(p.lg); delete ch[0].sp; broke = true; return; }
      if (ci === 0 && headLg && headLg.k === 'n') { setLg(text === old.slice(i0, i1).map(w => w.t).join(' ') ? headLg : Object.assign({}, headLg, { hand: true })); broke = true; return; }
      let done = false;
      if (ctx.on) {
        for (const l of labels) { // "THE COURT: ..." typed at the start: that speaker, as colloquy
          const want = toks(l + ':'), n = want.length; if (ch.length <= n || !want.every((t, k) => ch[k].t.toLowerCase() === t.toLowerCase())) continue;
          const first = Object.assign({}, ch[n]); if (ch[0].p) first.p = true; first.sp = l; delete first.lg; ch.splice(0, n + 1, first); done = true; break;
        }
        if (!done && ex && ch.length > 1 && /^[QA]\.$/.test(ch[0].t)) { // "Q. ..." / "A. ..." typed at the start, inside an examination
          const k = ch[0].t === 'Q.' ? 'q' : 'a', first = Object.assign({}, ch[1], { lg: { k } }); if (ch[0].p) first.p = true; first.sp = k === 'q' ? ex.by : ctx.witness; if (!first.sp) delete first.sp; ch.splice(0, 2, first); done = true;
        }
      }
      if (!done) {
        if (ci === 0) setLg(headLg);
        else if (last && broke) { setLg(last.lg ? { k: last.lg.k } : null); if (last.sp) ch[0].sp = last.sp; }
        else if (ctx.on && last && last.lg && (last.lg.k === 'q' || last.lg.k === 'a')) { const k = last.lg.k === 'q' ? 'a' : 'q', sp = k === 'q' ? (ex && ex.by) : ctx.witness; setLg({ k }); if (sp) ch[0].sp = sp; }
      }
      last = { lg: ch[0].lg && ch[0].lg.k !== 'n' ? ch[0].lg : null, sp: ch[0].sp }; broke = false;
    });
    const flat = [].concat(...chunks);
    // events written into the running text: found again by their words; one whose words were changed is gone
    const runs = []; old.slice(i0, i1).forEach((w, k) => { if (w.lg && w.lg.k === 'i') runs.push({ lg: w.lg, txt: old.slice(i0 + k, i0 + k + (w.lg.len || 1)).map(x => x.t).join(' ') }); });
    for (const p of pend) if (p.lg.k === 'i' && !p.used) runs.push(p);
    const taken = new Set();
    for (const r of runs) {
      const want = toks(r.txt), n = want.length;
      for (let k = 0; k + n <= flat.length; k++) { if (taken.has(k) || flat[k].lg || !want.every((t, g) => flat[k + g].t === t)) continue; flat[k].lg = Object.assign({}, r.lg, { len: n }); taken.add(k); r.used = true; break; }
    }
    // many words added at the end of a paragraph can be timed past the start of the next one: they stop there
    const cap = neu[end] && neu[end].s != null ? neu[end].s : null;
    if (cap != null) for (const w of flat) { if (w.s != null && w.s > cap) w.s = cap; if (w.e != null && w.e > cap) w.e = Math.max(w.s ?? cap, cap); }
    return neu.slice(0, i0).concat(flat, neu.slice(end));
  }

  /* ---- exports ---- */
  /* only what was said: the notation paragraphs taken out (subtitles carry speech, and a notation has no spoken time) */
  function spoken(words) { const out = []; let skip = false; words.forEach((w, i) => { if (i === 0 || w.p) skip = kind(w) === 'n'; if (!skip) out.push(w); }); if (out.length && !out[0].p) out[0] = Object.assign({}, out[0], { p: true }); return out; }
  /* the transcript as blocks in the preset's layout: centred headings, parentheticals, by-lines, Q, A, colloquy */
  function blocks(words, pre, opt = {}) {
    const out = [], qa = Object.assign({}, pre.qa, opt.qaLayout ? { layout: opt.qaLayout } : {}); let ex = null, needBy = false;
    for (const p of T.paragraphs(words)) {
      const w = words[p.i0], k = kind(w), text = words.slice(p.i0, p.i1).map(x => x.t).join(' ');
      if (w.lg && w.lg.ex) { ex = w.lg.ex; needBy = true; } else if (closes(w)) ex = null;
      if (k === 'n') { out.push({ type: /^[^a-z]*$/.test(text) && !/^[(\[]/.test(text) && pre.page.center ? 'center' : 'paren', text, i: p.i0 }); if (ex) needBy = true; continue; }
      if (k === 'c') { out.push({ type: 'colloquy', label: p.speaker, text, i: p.i0 }); if (ex) needBy = true; continue; }
      if (qa.layout === 'letters') {
        if (k === 'q' && needBy && qa.byline && ex && ex.by) out.push({ type: 'byline', text: fill(qa.byline, { by: ex.by }), i: p.i0 });
        if (k === 'q') needBy = false;
        out.push({ type: k, text, i: p.i0 });
      } else if (qa.layout === 'dash' && k === 'a' && out.length && out[out.length - 1].q) { const b = out[out.length - 1]; b.text += (qa.dash || ' --- ') + text; b.q = false; }
      else out.push({ type: 'colloquy', label: p.speaker || (k === 'q' ? (ex && ex.by) || '' : ''), text, i: p.i0, q: k === 'q' });
    }
    return out;
  }
  function wrap(first, width) {
    if (!width) return [first]; const out = []; let line = '';
    const lead = /^ */.exec(first)[0]; let rest = first.slice(lead.length), cur = lead;
    for (const tok of rest.split(' ')) { if ((cur + (cur.trim() ? ' ' : '') + tok).length > width && cur.trim()) { out.push(cur); cur = tok; } else cur += (cur.trim() ? ' ' : '') + tok; }
    out.push(cur); return out.length ? out : [line];
  }
  /* each block as lines: indents from the preset's page; carry-over lines go back to the left margin */
  function blockLines(b, pre, width) {
    const pg = pre.page, sp = n => ' '.repeat(Math.max(0, n)), W = width || pg.width;
    if (b.type === 'center') return wrap(b.text, W).map(l => sp(Math.floor((W - l.length) / 2)) + l);
    if (b.type === 'paren') return wrap(sp(pg.paren) + b.text, width);
    if (b.type === 'byline') return wrap(b.text, width);
    if (b.type === 'q' || b.type === 'a') { const l = pre.qa[b.type]; return wrap(l + sp(Math.max(1, pg.qText - l.length)) + b.text, width); }
    return wrap(sp(pg.colloquy) + (b.label ? b.label + ':' + sp(pg.afterColon) : '') + b.text, width);
  }
  const frontLines = (legal, pre) => {
    const out = [], cv = (legal && legal.cover) || {};
    for (const f of pre.cover || []) if (String(cv[f] || '').trim()) out.push(`${f.toUpperCase()}: ${cv[f].trim()}`);
    const sl = ((legal && legal.people) || []).filter(p => String(p.name || '').trim());
    if (sl.length && out.length) { out.push('', 'APPEARANCES:'); for (const p of sl) out.push(`  ${personLabel(pre, p)}${p.party ? `, for ${p.party}` : ''}`); }
    return out;
  };
  /* the certificate, only when one was chosen; the name is what the person typed, and nothing is signed */
  const backLines = (legal, pre) => {
    const c = legal && legal.cert; if (!c || !c.text || !String(c.text).trim()) return [];
    return ['', 'CERTIFICATE', '', ...wrap(String(c.text).trim(), pre.page.width), '', `${(c.name || '').trim() || '____________________'}`, `Date: ${(c.date || '').trim() || '__________'}`];
  };
  /* plain legal text: one block per paragraph in the preset's layout, a blank line between */
  function toTxt(words, legal, pre, opt = {}) {
    const bl = blocks(words, pre, { qaLayout: legal && legal.qaLayout }), out = [];
    const front = frontLines(legal, pre); if (front.length) out.push(front.join('\n'));
    for (const b of bl) { const ls = blockLines(b, pre, 0); if (opt.stamps && b.type !== 'byline' && words[b.i].s != null) ls[0] = `[${T.hms(words[b.i].s)}] ${ls[0]}`; out.push(ls.join('\n')); }
    const back = backLines(legal, pre); if (back.length) out.push(back.join('\n').replace(/^\n/, ''));
    return out.join('\n\n') + '\n';
  }
  /* numbered pages: fixed lines a page, wrapped here (not by a word processor), so page:line references can be trusted.
     Returns the text and where each paragraph starts: refs.get(first word index) = "page:line". */
  function toPages(words, legal, pre, opt = {}) {
    const per = Math.max(5, opt.lines || pre.page.lines), W = opt.width || pre.page.width, tens = (opt.numbers || pre.page.numbers) === 'tens';
    const refs = new Map(), all = [];
    for (const l of frontLines(legal, pre)) all.push({ t: l }); if (all.length) while (all.length % per) all.push({ t: '' });
    for (const b of blocks(words, pre, { qaLayout: legal && legal.qaLayout })) blockLines(b, pre, W).forEach((t, k) => all.push({ t, i: k === 0 && b.type !== 'byline' ? b.i : null }));
    const body = all.length; for (const l of backLines(legal, pre)) all.push({ t: l });
    const pages = []; all.forEach((l, k) => { const pg = Math.floor(k / per), ln = k % per + 1; if (!pages[pg]) pages[pg] = []; if (l.i != null && k < body) refs.set(l.i, `${pg + 1}:${ln}`); pages[pg].push(`${tens ? (ln % 10 ? '  ' : pad(ln).replace(/^0/, ' ')) : String(ln).padStart(2, ' ')}  ${l.t}`.replace(/\s+$/, '')); });
    const text = pages.map((ls, k) => `${' '.repeat(Math.max(0, W + 4 - String(k + 1).length))}${k + 1}\n${ls.join('\n')}\n`).join('\f\n');
    return { text, refs, pages: pages.length };
  }
  /* the exhibit index and the witness index as text. where(i) says where an event is: a time, or page:line */
  function indexText(words, pre, where) {
    const evs = events(words), out = [], at = e => (e ? where(e) : '--'), col = (s, n) => (String(s) + '  ').padEnd(n, ' ');
    out.push('WITNESSES', '');
    if (!evs.witnesses.length && !evs.loose.length) out.push('  (none noted)');
    for (const w of evs.witnesses) { out.push(`  ${col(`${String(w.name || '').toUpperCase()}${w.oath ? ` (${w.oath})` : ''}${w.party ? `, ${w.party} witness` : ''}`, 44)}${at(w)}`); for (const e of w.exams) out.push(`      ${col(`${e.col}${e.by ? ` by ${e.by}` : ''}`, 40)}${at(e)}`); }
    for (const e of evs.loose) out.push(`  ${col(`${e.col}${e.by ? ` by ${e.by}` : ''} (no witness noted above it)`, 44)}${at(e)}`);
    out.push('', 'EXHIBITS', '', `  ${col('', 34)}${col('Marked', 10)}Received`);
    const rows = exhibitRows(evs); if (!rows.length) out.push('  (none noted)');
    for (const r of rows) { out.push(`  ${col(`${r.party ? r.party + ' ' : ''}Exhibit ${r.n}`, 34)}${col(at(r.marked), 10)}${at(r.received)}`); if (r.desc) out.push(`      ${r.desc}`); for (const o of r.other) out.push(`      ${o.ev}: ${at(o)}`); }
    return out.join('\n') + '\n';
  }
  /* before saving: things a person should look at. Each: { what, n, at: [word indexes] } */
  function check(words, pre) {
    const out = [], ins = inserts(pre), add = (what, at) => { if (at.length) out.push({ what, n: at.length, at }); };
    const cores = k => ins.filter(x => x.count === k).map(x => (/[a-z]{2,}/i.exec(x.tpl) || [''])[0].toLowerCase()).filter(Boolean);
    const unclear = [...new Set(cores('unclear').concat(['inaudible', 'indiscernible', 'indistinct']))], ph = /^[(\[](phonetic|ph)[)\]][.,;:?!]*$/i;
    const isTag = w => /[(\[]/.test(w.t) && unclear.some(c => w.t.toLowerCase().includes(c));
    add('Inaudible or indiscernible tags (courts treat many of them as a defect: replay each one)', words.map((w, i) => (isTag(w) ? i : -1)).filter(i => i >= 0));
    if (/\{time\}/.test(pre.wording.ina || '')) add('Inaudible tags with no time (this style wants the time in the tag)', words.map((w, i) => (isTag(w) && /[\])]/.test(w.t) ? i : -1)).filter(i => i >= 0));
    add('Names still marked (phonetic): check the spelling', words.map((w, i) => (ph.test(w.t) ? i : -1)).filter(i => i >= 0));
    const evs = events(words);
    if (pre.wording.exr) add('Exhibits marked but not received', exhibitRows(evs).filter(r => r.marked && !r.received).map(r => r.marked.i));
    add('Speakers not identified', heads(words).filter(h => /^(speaker \d+|unidentified|male speaker|female speaker)/i.test(words[h].sp || '')));
    add('Examinations with no witness noted above them', evs.loose.map(e => e.i));
    add('Questions and answers out of order', [...warnings(words).keys()]);
    add('Wording blanks left to fill (___)', words.map((w, i) => (/___/.test(w.t) ? i : -1)).filter(i => i >= 0));
    return out;
  }

  const api = { CAT, preset, inserts, byCode, fields, fill, sample, fmtTime, clockAt, codeAt, roleLabel, personLabel, slots, resolveBy, nextId, heads, headOf, paraEnd, events, exhibitRows, proposeExhibit, alreadyMarked, insertBlock, insertInline, kind, examAt, examEnd, flowQA, setQA, warnings, edited, spoken, blocks, blockLines, toTxt, toPages, indexText, check };
  root.LegalCore = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
