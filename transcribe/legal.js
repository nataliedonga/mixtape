/* Mixtape transcripts: legal inserts. Exhibits, witnesses, examinations, speakers and the notations of legal
   transcription, put in by a short code typed while correcting (;ina then space), from a list (Ctrl + . or Insert),
   or with one key (Alt + 1…9 for speakers, Alt + Q for question / answer).
   Rules that are never broken here: nothing is inserted by itself; nothing is guessed (an exhibit number, a name, an
   oath, a time of day are asked for, proposed at most, and shown before they go in); nothing leaves this computer.
   The rules with no page: ../legal-core.js. The wording per kind of work: legal-presets.js. Started by app.js with
   initLegal(api); this file only touches the page through that api and its own elements. */
const L = window.LegalCore, P = window.LegalPresets;

export function initLegal(api) {
  if (!L || !P) throw new Error('legal-core.js or legal-presets.js did not load');
  const { T, toast, esc } = api, $ = s => document.querySelector(s);
  const h = (tag, cls, html) => { const el = document.createElement(tag); if (cls) el.className = cls; if (html != null) el.innerHTML = html; return el; };

  /* ---------- kept on this device: the person's own wording and codes, what was used last ---------- */
  const KEY = 'mixtape-legal';
  const dev = Object.assign({ wording: {}, codes: {}, recent: [], preset: P.DEFAULT, told: false }, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })());
  let devV = 0; const saveDev = () => { devV++; try { localStorage.setItem(KEY, JSON.stringify(dev)); } catch (e) { /* private window: kept until the page closes */ } };

  /* ---------- this transcript ---------- */
  const tr = () => (api.cur && api.cur.tr) || null;
  const lg = () => { const r = tr(); return (r && r.legal) || null; };
  const on = () => !!(lg() && lg().on);
  let memo = { k: '', pre: null, ins: null, codes: null };
  const pre = () => { const id = (lg() && lg().preset) || dev.preset, k = id + '|' + devV; if (memo.k !== k) { const p = L.preset(id, dev), ins = L.inserts(p); memo = { k, pre: p, ins, codes: L.byCode(ins) }; } return memo.pre; };
  const ins = () => (pre(), memo.ins), codes = () => (pre(), memo.codes);
  const slots = () => L.slots(pre(), lg());
  const witness = () => L.roleLabel(pre(), lg(), 'w');
  const playhead = () => (api.cur ? api.cur.media.currentTime || 0 : 0);
  const curWord = () => { const r = tr(); return r && r.words.length ? T.wordAt(r.words, playhead(), T.timedUpTo(r.words)) : -1; };
  const editBox = () => { const e = api.editing; return e ? e.p.querySelector('textarea') : null; };
  const busy = () => { if (api.job) { toast('Pause first, then insert.'); return true; } return false; };
  /* a change to the words: one step back with Ctrl + Z, saved, redrawn, the changed paragraph shown */
  async function change(fn, flashAt) {
    api.remember(); fn(tr()); await api.save(); api.drawText();
    if (flashAt != null) { const w = $(`#text .w[data-i="${flashAt}"]`), p = w && w.closest('.para'); if (p) { p.classList.add('lgflash'); p.scrollIntoView({ block: 'nearest' }); setTimeout(() => p.classList.remove('lgflash'), 1600); } }
  }
  const grow = (r, at, n) => { api.shiftNotes(at, at, n); if (r.review) { r.review.fixes = T.shiftFixes(r.review.fixes || [], at - 1, n); r.review.speakers = T.shiftFixes(r.review.speakers || [], at - 1, n); } };

  /* ---------- turning it on, choosing the kind of work ---------- */
  async function setOn(v) {
    const r = tr(); if (!r) return; if (api.editing) return toast('Save or cancel the paragraph you are correcting first.');
    r.legal = Object.assign({ preset: dev.preset, people: [], roles: {}, last: {} }, r.legal, { on: v }); await api.save(); api.drawText();
    toast(v ? `Legal inserts are on (${pre().name}). Ctrl + . or Insert lists them. Nothing is ever inserted by itself.` : 'Legal inserts are off. What was inserted stays in the transcript.', 6000);
  }
  async function setPreset(id) {
    const r = tr(); if (!r || !lg()) return; if (api.editing) return toast('Save or cancel the paragraph you are correcting first.');
    // the same person or role under both styles: the appearances, and the roles that mean the same everywhere (judge, witness, defendant, interpreter)
    const same = ['j', 'w', 'd', 'i'], lab = () => [...(lg().people || []).map(p => (String(p.name || '').trim() ? L.personLabel(pre(), p) : '')), ...same.map(k => L.roleLabel(pre(), lg(), k))], before = lab();
    await change(() => {
      r.legal.preset = id; dev.preset = id; saveDev();
      const after = lab(), pairs = before.map((b, k) => [b, after[k]]);
      const names = new Set(T.speakerNames(r.words)); // labels are the preset's to format: THE COURT becomes COURT, MR. SMITH becomes MR SMITH
      for (const [a, b] of pairs) if (a && b && a !== b && names.has(a) && !names.has(b)) { r.words = T.renameSpeaker(r.words, r.voices, a, b); names.delete(a); names.add(b); }
      r.words = r.words.map(w => (w.lg && w.lg.ex && w.lg.ex.by && before.includes(w.lg.ex.by) && after[before.indexOf(w.lg.ex.by)] ? { ...w, lg: { ...w.lg, ex: { ...w.lg.ex, by: after[before.indexOf(w.lg.ex.by)] } } } : w));
    });
    toast(`${pre().name}. The same codes; the wording is this style’s. Inserts already made keep their wording.`, 5000);
  }
  function legalMenu(anchor) {
    const r = tr(); if (!r) return; anchor = anchor || $('[data-lg="menu"]') || $('#keysBtn') || $('#bPlay');
    const items = [['Legal transcript', null]];
    if (!on()) items.push(['Turn on legal inserts for this transcript', () => setOn(true)]);
    else {
      items.push(['Kind of work', null], ...P.ORDER.map(id => [`${id === pre().id ? '● ' : '○ '}${P.PRESETS[id].name}`, () => setPreset(id)]),
        ['Set up', null], ['Appearances and speakers…', appearances], ['Wording and short codes…', wordingPanel], ['Cover, certificate and page…', coverPanel],
        ['Turn off legal inserts (what was inserted stays)', () => setOn(false)]);
    }
    api.menu(anchor, items, { left: true });
  }

  /* ---------- what the page shows: the legal bar, the marks on paragraphs, the Insert button in the correction box ---------- */
  let drawing = false;
  const obs = new MutationObserver(() => { if (drawing) return; drawing = true; queueMicrotask(() => { obs.disconnect(); try { decorate(); } catch (e) { console.warn('legal:', e); } watch(); drawing = false; }); });
  const watch = () => { obs.observe($('#tools'), { childList: true, subtree: true }); obs.observe($('#text'), { childList: true, subtree: true }); };
  function decorate() { decorateTools(); decorateText(); decorateEdit(); }
  function decorateTools() {
    const box = $('#tools'), r = tr(); if (!r || box.hidden || !r.words.length) return;
    if (!box.querySelector('[data-lg="menu"]')) {
      const b = h('button', 'btn sm lgbtn' + (on() ? ' on' : ''), on() ? '§ Legal ▾' : '§ Legal'); b.dataset.lg = 'menu'; b.setAttribute('aria-haspopup', 'menu');
      b.title = on() ? `Legal inserts are on: ${pre().name}. Kind of work, appearances, wording, cover.` : 'Legal transcript: inserts for exhibits, witnesses, examinations and speakers, by short code or from a list';
      const k = box.querySelector('#keysBtn'); if (k) k.before(b); else box.append(b);
    }
    const clean = box.querySelector('input[data-v="clean"]');
    if (!on()) { if (dev.cleanWas && clean && !clean.checked) { dev.cleanWas = false; saveDev(); clean.click(); return decorateTools(); } return; } // the clean script comes back for other recordings
    if (box.querySelector('.lgbar')) return;
    if (clean) { if (clean.checked) { dev.cleanWas = true; saveDev(); clean.click(); toast('Clean script is switched off for a legal transcript: nothing is removed for you.', 6000); return decorateTools(); } clean.disabled = true; clean.closest('label').title = `Off in a legal transcript. ${pre().clean || ''}`; clean.closest('label').classList.add('lgoff'); }
    const evs = L.events(r.words), n = L.exhibitRows(evs).length + evs.witnesses.length, warn = L.warnings(r.words).size, sl = slots();
    const bar = h('div', 'lgbar');
    bar.innerHTML = `<button class="btn sm primary" data-lg="insert" aria-haspopup="listbox" title="Insert a legal notation (Ctrl + .). While correcting a paragraph, type its short code and a space: ;ina">＋ Insert ▾</button>`
      + `<span class="lgslots" role="group" aria-label="Speakers: click one (or press Alt and its number) to make it the speaker of the paragraph being played">${sl.map(s => `<button class="lgchip" data-lg="slot" data-n="${s.n}" aria-label="Speaker ${s.n}: ${esc(s.label)}" title="${esc(s.what)}: Alt + ${s.n}, or ;${s.n} while correcting"><kbd>${s.n}</kbd>${esc(s.label)}</button>`).join('')}<button class="lgchip add" data-lg="people" title="Who appears: fills the speaker slots">${sl.length > pre().fixed.length ? 'Appearances…' : '+ Appearances…'}</button></span>`
      + `<button class="btn sm" data-lg="qa" title="Switch the paragraph being played between question and answer (Alt + Q; with Shift, all that follow too)">Q ⇄ A</button>`
      + `<span class="sp"></span><button class="btn sm" data-lg="index" title="The exhibit index and the witness index, built from your inserts">Exhibits and witnesses${n ? ` (${n})` : ''}</button>`
      + (warn ? `<button class="btn sm lgw" data-lg="check" title="Questions and answers out of order: see the check">! ${warn}</button>` : '');
    box.append(bar);
  }
  function decorateText() {
    const r = tr(), box = $('#text'); if (!r || !r.words.length || !r.words.some(w => w.lg)) return;
    const warn = on() ? L.warnings(r.words) : new Map(), by = new Map(); if (on()) for (const b of L.blocks(r.words, pre(), { qaLayout: 'letters' })) if (b.type === 'byline') by.set(b.i, b.text);
    for (const p of box.querySelectorAll('.para:not([data-lgd])')) {
      p.dataset.lgd = '1'; const i0 = +p.dataset.i0, w = r.words[i0], k = L.kind(w), gut = p.querySelector('.gut'), ws = p.querySelector('.words'); if (!w || !gut || !ws) continue;
      if (k === 'n') { p.classList.add('lgn'); const c = L.CAT.get(w.lg.id); ws.title = `${c ? c.name : 'Legal notation'}${w.lg.x || w.lg.w || w.lg.ex ? ' · in the index' : ''}${w.lg.hand ? ' · reworded by hand: the index keeps what was entered' : ''}`; }
      else if (k === 'q' || k === 'a') { p.classList.add('lg' + k); const b = h('button', 'lgqa', k.toUpperCase()); b.dataset.lg = 'qaAt'; b.title = `${k === 'q' ? 'Question' : 'Answer'}. Click to switch (Shift + click: and all that follow).`; b.setAttribute('aria-label', `${k === 'q' ? 'Question' : 'Answer'}: switch`); gut.append(b); }
      else if (on() && L.examAt(r.words, i0)) { const b = h('button', 'lgqa none', 'Q/A'); b.dataset.lg = 'qaAt'; b.title = 'Colloquy. Click to mark it as a question.'; gut.append(b); }
      if (by.has(i0) && !ws.querySelector('.edit')) ws.prepend(h('span', 'lgby', esc(by.get(i0))));
      if (warn.has(i0)) { const s = h('span', 'lgwarn', '!'); s.title = warn.get(i0); s.setAttribute('role', 'img'); s.setAttribute('aria-label', 'Check: ' + warn.get(i0)); gut.append(s); }
      for (let i = i0 + 1; i < +p.dataset.i1; i++) if (r.words[i].lg && r.words[i].lg.k === 'i') for (let g = 0; g < (r.words[i].lg.len || 1); g++) { const el = ws.querySelector(`.w[data-i="${i + g}"]`); if (el) { el.classList.add('lgx'); el.title = 'Exhibit event · in the index'; } }
    }
  }
  function decorateEdit() {
    const row = $('#text .edit .row'); if (!row || !on() || row.querySelector('[data-lg]')) return;
    const b = h('button', 'btn sm lgins', '＋ Insert ▾'); b.dataset.lg = 'insert'; b.title = 'Insert a legal notation here (Ctrl + .)'; b.setAttribute('aria-haspopup', 'listbox');
    const hint = row.querySelector('.hint'); if (hint) { hint.insertAdjacentHTML('beforeend', ' <b>;code</b> then space inserts (<b>;ina</b>).'); hint.after(b); } else row.prepend(b);
  }

  /* ---------- the correction box: text put in so that one Ctrl + Z (or Backspace) takes it out again ---------- */
  let mine = false, lastExp = null, escaped = null, pending = [];
  function put(ta, start, end, text) {
    ta.focus(); ta.setSelectionRange(start, end); mine = true;
    try { if (!document.execCommand('insertText', false, text)) ta.setRangeText(text, start, end, 'end'); } catch (e) { ta.setRangeText(text, start, end, 'end'); } mine = false;
  }
  /* a notation line of its own inside the box: blank lines around it, the caret after it */
  function putBlock(ta, start, end, text) {
    const v = ta.value, before = v.slice(0, start).trim() && !/\n[ \t]*\n\s*$/.test(v.slice(0, start)) ? '\n\n' : '', after = /^\s*\n\s*\n/.test(v.slice(end)) ? '' : '\n\n';
    while (start > 0 && v[start - 1] === ' ') start--;
    put(ta, start, end, before + text + after);
  }
  const chunkStart = (v, at) => { const re = /\n[ \t]*\n/g, head = v.slice(0, at); let s = 0, m; while ((m = re.exec(head))) s = m.index + m[0].length; while (s < at && /\s/.test(v[s])) s++; return s; };
  const labels = () => { const r = tr(); return [...new Set([...slots().map(s => s.label), ...Object.keys(pre().roles).map(k => L.roleLabel(pre(), lg(), k)), ...(r ? T.speakerNames(r.words) : [])])].filter(Boolean); };
  /* how much of a paragraph's start is a label typed earlier ("THE COURT: ", "Q. "): the next label replaces it */
  const prefixLen = rest => { const old = labels().sort((a, b) => b.length - a.length).find(l => rest.toLowerCase().startsWith(l.toLowerCase() + ':')); return old ? old.length + 1 + (rest[old.length + 1] === ' ' ? 1 : 0) : /^[QA]\. /.test(rest) ? 3 : 0; };
  function speakerInBox(ta, label, origin) {
    const v = ta.value;
    if (origin) { const cs = chunkStart(v, origin.start), atStart = !v.slice(cs, origin.start).trim(); put(ta, atStart ? cs : origin.start, origin.end, (atStart ? '' : '\n\n') + label + ': '); return; }
    const caret = ta.selectionStart, cs = chunkStart(v, caret), cut = prefixLen(v.slice(cs)), neu = label + ': ', back = Math.max(0, caret - cs - cut);
    put(ta, cs, cs + cut, neu); ta.setSelectionRange(cs + neu.length + back, cs + neu.length + back);
  }
  function qaInBox(ta) {
    const e = api.editing, r = tr(); if (!L.examAt(r.words, e.i0)) return toast('Start an examination first: ;dx, or Insert ▾ → Examinations.', 5000);
    const v = ta.value, caret = ta.selectionStart, cs = chunkStart(v, caret), m = /^([QA])\. /.exec(v.slice(cs)), cut = prefixLen(v.slice(cs));
    const now = m ? m[1].toLowerCase() : cs === 0 && !cut ? L.kind(r.words[e.i0]) : 'c', neu = now === 'q' ? 'A. ' : 'Q. ', back = Math.max(0, caret - cs - cut);
    put(ta, cs, cs + cut, neu); ta.setSelectionRange(cs + 3 + back, cs + 3 + back);
    toast(neu === 'Q. ' ? 'This paragraph will be a question.' : 'This paragraph will be an answer.', 1800);
  }

  /* ---------- inserting ---------- */
  const used = id => { dev.recent = [id, ...dev.recent.filter(x => x !== id)].slice(0, 8); saveDev(); };
  const origin = ta => (ta ? { ta, start: ta.selectionStart, end: ta.selectionEnd, typed: null } : null);
  /* item: an insert of this preset, or { slot: n }. where: null (the paragraph being played) or a place in the correction box */
  function insert(item, where) {
    if (!on() || busy()) return; closePalette();
    if (item.slot) { const s = slots()[item.slot - 1]; if (!s) return toast(`Speaker slot ${item.slot} is empty. Fill it under Appearances.`, 5000); return speaker(s.label, where); }
    if (item.kind === 'sp') return speaker(item.tpl, where);
    const want = L.fields(item.tpl); if (item.kind === 'ex' && !want.includes('by')) want.push('by'); if (item.kind === 'xh' && !want.includes('n')) want.unshift('n');
    if (want.length) form(item, want, where); else place(item, {}, where);
  }
  function place(item, vals, where) {
    const r = tr(), at = playhead(), all = Object.assign({}, vals, { time: L.fmtTime(at, pre().time) }), text = L.fill(item.tpl, all), c = item, inline = c.kind === 'in' || (c.kind === 'xh' && (pre().inline || []).includes(c.as || c.id));
    let mark = null;
    if (c.kind === 'xh') mark = { id: c.as || c.id, x: { party: vals.party || '', n: vals.n || '', ...(vals.n2 ? { n2: vals.n2 } : {}), ...(vals.desc ? { desc: vals.desc } : {}), ev: c.ev } };
    else if (c.kind === 'wi') mark = { id: c.id, w: { name: vals.name || '', party: vals.party || '', oath: c.oath || '' } };
    else if (c.kind === 'ex') mark = { id: c.id, ex: { type: c.id, by: vals.by || '' } };
    else if (c.kind === 'bl') mark = { id: c.id };
    if (mark && !inline) mark.k = 'n';
    used(c.id); const last = lg().last || (lg().last = {}); for (const k of ['party', 'by', 'date', 'what', 'reason', 'desc']) if (vals[k] != null) last[k] = vals[k]; if (c.kind === 'wi' && vals.name) last.name = vals.name;
    const ta = where && where.ta, e = api.editing;
    if (ta && ta.isConnected) {
      if (c.noHeading || (c.kind === 'ex' && !text)) { // questions and answers start at this paragraph: it is saved first
        const i0 = e.i0; if (where.typed) put(ta, where.start, where.end, '');
        return api.saveEdit(ta.value).then(() => startQA(i0, vals.by));
      }
      const v0 = ta.value, tail = where.trigger === ' ' && inline ? ' ' : '';
      if (inline) { put(ta, where.start, where.end, text + tail); if (mark) pending.push({ txt: text, lg: Object.assign({ k: 'i', at: +at.toFixed(3) }, mark) }); }
      else { putBlock(ta, where.start, where.end, text); pending.push({ txt: text, lg: Object.assign({ at: +at.toFixed(3) }, mark) }); }
      lastExp = where.typed ? { ta, before: v0, typed: where.typed, start: where.start, after: ta.value, caret: ta.selectionStart, pend: mark ? pending[pending.length - 1] : null } : null;
      hintNear(ta, `${c.name}${where.typed ? ' · Backspace puts the code back' : ''}${c.warn ? ` · ${c.warn}` : ''}`, c.warn ? 9000 : 4000);
      return;
    }
    if (!r.words.length) return;
    if (c.noHeading || (c.kind === 'ex' && !text)) return startQA(L.headOf(r.words, Math.max(0, curWord())), vals.by);
    const i = curWord(); let res;
    change(() => {
      res = inline ? L.insertInline(r.words, i, text, mark, at) : L.insertBlock(r.words, i, text, mark, at); r.words = res.words; grow(r, res.at, res.n);
      if (c.kind === 'ex') r.words = L.flowQA(r.words, res.at, vals.by, witness());
    }, null).then(() => { flash(res.at); toast(`${text.length > 70 ? text.slice(0, 68) + '…' : text} · ${i < 0 ? 'put in at the start' : inline ? 'put in after the word being spoken' : 'put in after the paragraph being played'}${c.kind === 'ex' ? '. Questions and answers are proposed below it: switch any that are wrong (Alt + Q).' : ''} Ctrl + Z undoes.${c.warn ? ` ${c.warn}` : ''}`, c.kind === 'ex' || c.warn ? 9000 : 4000); });
  }
  const flash = at => { const w = $(`#text .w[data-i="${at}"]`), p = w && w.closest('.para'); if (p) { p.classList.add('lgflash'); p.scrollIntoView({ block: 'nearest' }); setTimeout(() => p.classList.remove('lgflash'), 1600); } };
  function startQA(i0, by) {
    const r = tr(); let head;
    return change(() => { head = L.headOf(r.words, i0); r.words = r.words.slice(); r.words[head] = { ...r.words[head], lg: { ...(r.words[head].lg || {}), k: 'q', ex: { type: 'qa', by: by || '' } }, ...(by ? { sp: by } : {}) }; r.words = L.flowQA(r.words, head, by, witness()); }).then(() => { flash(head); toast('Questions and answers are proposed from here: switch any that are wrong (Alt + Q). Ctrl + Z undoes.', 7000); });
  }
  let hintT = 0; function hintNear(ta, text, ms = 4000) { let el = ta.parentNode.querySelector('.lgsaid'); if (!el) { el = h('div', 'lgsaid'); el.setAttribute('role', 'status'); ta.after(el); } el.textContent = text; clearTimeout(hintT); hintT = setTimeout(() => el.remove(), ms); }

  /* speakers: a slot or a role label on the paragraph being played, or on the paragraph the caret is in */
  function speaker(label, where) {
    if (!label) return; const ta = where && where.ta;
    if (ta && ta.isConnected) { const v0 = ta.value; speakerInBox(ta, label, where.typed ? where : null); lastExp = where.typed ? { ta, before: v0, typed: where.typed, start: where.start, after: ta.value, caret: ta.selectionStart } : null; return hintNear(ta, `Speaker: ${label}`); }
    const r = tr(); if (!r.words.length) return; const head = L.headOf(r.words, Math.max(0, curWord()));
    if (L.kind(r.words[head]) === 'n') return toast('The paragraph being played is a notation: it has no speaker.');
    change(() => { r.words = L.setQA(T.setSpeaker(r.words, head, label), head, 'c'); }).then(() => { flash(head); toast(`${label} · the paragraph at ${T.short(r.words[head].s || 0)}`, 2200); });
  }
  function toggleQA(head, following) {
    const r = tr(); if (busy()) return; if (head == null) head = L.headOf(r.words, Math.max(0, curWord()));
    const ex = L.examAt(r.words, head), k = L.kind(r.words[head]);
    if (k === 'n') return toast('That is a notation, not something said.');
    if (!ex) return toast('Start an examination first: Insert ▾ → Examinations (;dx), or “Questions and answers start here”.', 6000);
    const to = k === 'q' ? 'a' : 'q';
    change(() => { r.words = L.setQA(r.words, head, to, ex.by, witness(), following); }).then(() => { flash(head); toast(`${to === 'q' ? 'Question' : 'Answer'}${following ? ', and all that follow switched' : ''}.`, 1800); });
  }

  /* ---------- a small form for the values an insert needs: shown before it goes in, Enter confirms ---------- */
  let formEl = null;
  /* inserts typed into the open correction box are not in the words yet: they count for the next proposal all the same */
  const withPending = evs => { for (const p of pending) { if (p.lg.x) evs.exhibits.push({ i: -1, para: -1, at: p.lg.at, id: p.lg.id, ...p.lg.x }); if (p.lg.w) evs.witnesses.push({ i: -1, para: -1, at: p.lg.at, id: p.lg.id, exams: [], ...p.lg.w }); } return evs; };
  function closeForm(back) { if (formEl) { formEl.remove(); formEl = null; document.removeEventListener('pointerdown', formOff, true); if (back && back.isConnected) back.focus(); } }
  const formOff = e => { if (formEl && !formEl.contains(e.target)) closeForm(); };
  function form(item, want, where) {
    closeForm(); const r = tr(), evs = withPending(L.events(r.words)), last = lg().last || {}, F = P.FIELDS, back = (where && where.ta) || document.activeElement;
    const order = ['party', 'n', 'n2', 'desc', 'name', 'by', 'clock', 'date', 'reason', 'what', 'lang'].filter(k => want.includes(k));
    const vals = {}, note = {};
    for (const k of order) vals[k] = k === 'n' || k === 'n2' || k === 'clock' || k === 'name' || k === 'desc' ? '' : last[k] || '';
    if (item.set) Object.assign(vals, item.set);
    if (item.kind === 'xh') { const p = L.proposeExhibit(evs, item.ev, item.set ? item.set.party : (order.includes('party') ? vals.party : '')); if (p.n) { vals.n = p.n; note.n = 'proposed from the last one: check it against the record'; if (order.includes('party')) vals.party = p.party; } }
    if (item.kind === 'wi' && item.again) { const w = evs.witnesses[evs.witnesses.length - 1]; if (w) { vals.name = w.name; if (order.includes('party')) vals.party = w.party; note.name = 'the last witness: check it'; } }
    if (order.includes('clock')) { const c = L.clockAt(lg().start, playhead()); if (c) { vals.clock = c; note.clock = `worked out from “recording began at ${lg().start}”: check it`; } else note.clock = 'the recording does not know the time of day: type it, or leave it out'; }
    const need = item.kind === 'xh' ? ['n'] : item.kind === 'wi' ? ['name'] : item.kind === 'ex' ? ['by'] : [];
    const el = formEl = h('div', 'lgform'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', item.name);
    const sl = slots(), listFor = k => (k === 'by' ? sl.map(s => s.label) : (item.lists && item.lists[k]) || F[k].list || []);
    el.innerHTML = `<div class="lgf-t">${esc(item.name)}${item.ev ? ` <small>· ${esc(item.ev)}</small>` : ''}</div><div class="lgf-p" aria-live="polite"></div><div class="lgf-r">`
      + order.map(k => `<label class="lgf-f"><span>${esc(F[k].label)}</span><input data-k="${k}" value="${esc(vals[k])}" placeholder="${esc(F[k].hint)}" size="${F[k].size}" autocomplete="off" spellcheck="false"${listFor(k).length ? ` list="lgdl-${k}"` : ''}>${listFor(k).length ? `<datalist id="lgdl-${k}">${listFor(k).map(x => `<option value="${esc(x)}">`).join('')}</datalist>` : ''}${note[k] ? `<small>${esc(note[k])}</small>` : ''}</label>`).join('')
      + `</div><div class="lgf-w" role="alert"></div>${item.warn ? `<div class="lgf-n">${esc(item.warn)}</div>` : ''}${item.unsourced ? '<div class="lgf-n">This wording is not from a published standard: check it against your client’s sample. You can change it under Legal ▾ → Wording.</div>' : ''}`
      + `<div class="lgf-b"><span class="lgf-h"><b>Enter</b> inserts · <b>Esc</b> cancels · <b>Tab</b> next box</span><span class="sp"></span><button class="btn sm" data-x>Cancel</button><button class="btn sm primary" data-ok>Insert</button></div>`;
    document.body.append(el);
    const inputs = [...el.querySelectorAll('input')], pv = el.querySelector('.lgf-p'), wn = el.querySelector('.lgf-w'); let ack = '';
    const read = () => { const o = {}; for (const i of inputs) o[i.dataset.k] = i.value.trim(); if ('by' in o) o.by = L.resolveBy(pre(), lg(), o.by); return o; };
    const dup = o => (item.kind === 'xh' && /^marked/.test(item.ev) && o.n ? L.alreadyMarked(evs, o.party || '', o.n) : null);
    const show = () => { const o = read(); pv.textContent = (L.fill(item.tpl, Object.assign({ time: L.fmtTime(playhead(), pre().time) }, o)) + (item.kind === 'ex' ? `${item.noHeading ? '' : '   ·   '}${pre().qa.byline && o.by ? L.fill(pre().qa.byline, o) + '   ·   ' : ''}questions by ${o.by || '…'}, answers by ${witness()}` : '')).trim(); const d = dup(o); wn.textContent = d ? `${o.party ? o.party + ' ' : ''}Exhibit ${o.n} is already marked, at ${T.short(d.at)}. An exhibit is marked once. Press Enter again to insert it anyway.` : ''; if (!d) ack = ''; };
    const ok = () => { const o = read(), miss = need.find(k => !o[k]); if (miss) { const i = inputs.find(x => x.dataset.k === miss); i.focus(); i.classList.add('bad'); wn.textContent = miss === 'by' ? 'Who is examining? A slot number, or a name such as “mr smith”.' : `${F[miss].label}: it has to come from the record.`; return; } const d = dup(o), key = `${o.party}|${o.n}`; if (d && ack !== key) { ack = key; show(); return; } closeForm(); place(item, o, where); };
    el.addEventListener('input', e => { e.target.classList.remove('bad'); show(); });
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); ok(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeForm(back); }
      else if (e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); const f = [...inputs, ...el.querySelectorAll('button')], k = f.indexOf(document.activeElement); f[(k + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); }
    });
    el.addEventListener('click', e => { if (e.target.closest('[data-ok]')) ok(); else if (e.target.closest('[data-x]')) closeForm(back); });
    show(); placeBy(el, where && where.ta ? where.ta : $('[data-lg="insert"]') || $('#bPlay'));
    const first = inputs.find(i => i.dataset.k === item.focus) || inputs.find(i => need.includes(i.dataset.k) && !i.value) || inputs.find(i => !i.value) || inputs[0]; first.focus(); first.select();
    setTimeout(() => document.addEventListener('pointerdown', formOff, true), 0);
  }
  function placeBy(el, anchor) {
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight; let y = r.bottom + 6; if (y + hh > innerHeight - 8) y = r.top - hh - 6 >= 8 ? r.top - hh - 6 : Math.max(8, innerHeight - hh - 8);
    el.style.top = Math.max(8, Math.min(innerHeight - hh - 8, y)) + 'px'; el.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left)) + 'px'; // never off the screen, wherever its button has scrolled to
  }

  /* ---------- the list of inserts: type to filter, arrows, Enter ---------- */
  let pal = null;
  function closePalette(back) { if (pal) { const el = pal.el, b = pal.back; pal = null; el.remove(); document.removeEventListener('pointerdown', palOff, true); if (back && b && b.isConnected) b.focus(); } }
  const palOff = e => { if (pal && !pal.el.contains(e.target)) closePalette(); };
  function palette(where) {
    if (pal) return closePalette(true); if (!on() || busy()) return; closeForm();
    const el = h('div', 'lgpal'); el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Insert a legal notation');
    el.innerHTML = `<input class="lgp-q" type="text" role="combobox" aria-expanded="true" aria-controls="lgList" aria-autocomplete="list" aria-label="Insert: type to filter, arrows to move, Enter inserts" placeholder="Insert… type to filter (inaudible, exhibit, cross)" autocomplete="off" spellcheck="false"><div class="lgp-l" id="lgList" role="listbox" aria-label="Legal inserts"></div><div class="lgp-f"><span>${esc(pre().name)}</span><span class="sp"></span><span><b>↑ ↓</b> move · <b>Enter</b> inserts · <b>Esc</b> closes · <b>Tab</b> plays / pauses</span></div>`;
    document.body.append(el);
    pal = { el, where, back: (where && where.ta) || document.activeElement, rows: [], at: 0 };
    const q = el.querySelector('input'), list = el.querySelector('.lgp-l');
    const all = () => [...slots().map(s => ({ slot: s.n, id: 'slot' + s.n, code: String(s.n), name: `${s.label}`, group: 'Speakers', tpl: s.what, kind: 'sp', key: `Alt + ${s.n}` })), ...ins()];
    const draw = () => {
      const s = q.value.trim().toLowerCase().replace(/^;/, ''), items = all(); let groups;
      if (!s) { const rec = dev.recent.map(id => items.find(x => x.id === id)).filter(Boolean); groups = [...(rec.length ? [['Used lately', rec]] : []), ...P.GROUPS.map(g => [g, items.filter(x => x.group === g)])]; }
      else { const sc = x => (x.code === s ? 0 : x.code.startsWith(s) ? 1 : x.name.toLowerCase().startsWith(s) ? 2 : x.name.toLowerCase().includes(s) ? 3 : String(x.tpl).toLowerCase().includes(s) || x.group.toLowerCase().includes(s) ? 4 : 9), hit = items.map(x => [sc(x), x]).filter(z => z[0] < 9).sort((a, b) => a[0] - b[0]).map(z => z[1]); groups = hit.length ? [['Matches', hit]] : []; }
      pal.rows = []; let n = 0;
      list.innerHTML = groups.filter(g => g[1].length).map(([g, xs]) => `<div role="group" aria-label="${esc(g)}"><div class="lgp-g" aria-hidden="true">${esc(g)}</div>${xs.map(x => { pal.rows.push(x); const k = n++; return `<div class="lgp-o" role="option" id="lgo${k}" data-k="${k}" aria-selected="false"><span class="n">${esc(x.name)}${x.unsourced ? ' <i title="Not from a published standard: check it against your client’s sample">check</i>' : ''}</span><span class="t">${esc(x.kind === 'sp' ? (x.slot ? x.tpl : x.tpl) : x.noHeading ? 'marks questions and answers from the paragraph being played' : L.sample(x.tpl))}</span><kbd>${esc(x.key || ';' + x.code)}</kbd>${x.warn ? `<span class="wn">${esc(x.warn)}</span>` : ''}</div>`; }).join('')}</div>`).join('') || '<div class="lgp-e">Nothing by that name in this style. Other kinds of work have other inserts: Legal ▾ → Kind of work.</div>';
      pal.at = 0; sel();
    };
    const sel = () => { list.querySelectorAll('.lgp-o').forEach((o, k) => { const y = k === pal.at; o.setAttribute('aria-selected', y); if (y) { o.scrollIntoView({ block: 'nearest' }); q.setAttribute('aria-activedescendant', o.id); } }); if (!pal.rows.length) q.removeAttribute('aria-activedescendant'); };
    const take = k => { const x = pal.rows[k]; if (!x) return; const w = pal.where; closePalette(); insert(x, w); };
    q.addEventListener('input', draw);
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); if (pal.rows.length) { pal.at = (pal.at + (e.key === 'ArrowDown' ? 1 : -1) + pal.rows.length) % pal.rows.length; sel(); } }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); take(pal.at); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePalette(true); }
    });
    list.addEventListener('click', e => { const o = e.target.closest('.lgp-o'); if (o) take(+o.dataset.k); });
    list.addEventListener('mousemove', e => { const o = e.target.closest('.lgp-o'); if (o && +o.dataset.k !== pal.at) { pal.at = +o.dataset.k; list.querySelectorAll('.lgp-o').forEach((x, k) => x.setAttribute('aria-selected', k === pal.at)); q.setAttribute('aria-activedescendant', o.id); } });
    draw(); if (innerWidth > 560) placeBy(el, (where && where.ta && where.ta.closest('.edit').querySelector('[data-lg="insert"]')) || $('.lgbar [data-lg="insert"]') || $('#bPlay')); q.focus();
    setTimeout(() => document.addEventListener('pointerdown', palOff, true), 0);
  }

  /* ---------- panels: appearances, wording, cover, the indexes, the check ---------- */
  let panelEl = null, lastBtn = null; // the button that opened a panel gets the focus back (the page blurs buttons on click)
  function closePanel() { if (panelEl) { const b = panelEl.back; panelEl.remove(); panelEl = null; const to = b && b.isConnected ? b : $('[data-lg="menu"]'); if (to) to.focus(); } }
  function panel(title, html, wide) {
    closePanel(); closePalette(); closeForm(); $('#menu').hidden = true;
    const el = panelEl = h('div', 'lgpanel'); el.back = lastBtn && lastBtn.isConnected ? lastBtn : document.activeElement;
    el.innerHTML = `<div class="lgpn${wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="lgpn-h"><h2>${esc(title)}</h2><span class="sp"></span><button class="btn sm" data-close aria-label="Close">Close</button></div><div class="lgpn-b">${html}</div></div>`;
    document.body.append(el);
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePanel(); } else if (e.key === 'Tab') { e.stopPropagation(); const f = [...el.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter(x => !x.disabled && x.offsetParent); if (!f.length) return; const k = f.indexOf(document.activeElement); if (e.shiftKey ? k <= 0 : k === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); } } });
    el.addEventListener('click', e => { if (e.target === el || e.target.closest('[data-close]')) closePanel(); });
    const f = el.querySelector('.lgpn-b input, .lgpn-b select, .lgpn-b textarea, .lgpn-b button') || el.querySelector('[data-close]'); f.focus();
    return el;
  }
  function appearances() {
    const r = tr(), g = lg(); if (!g) return; const p = pre(), people = [...(g.people || [])]; while (people.length < 9 - p.fixed.length) people.push({ title: p.titleList[0], name: '', party: '' });
    const voices = T.speakerNames(r.words).filter(n => !labels().includes(n) || /^speaker \d+$/i.test(n));
    const el = panel('Appearances and speakers', `<p class="lgpn-i">These fill the speaker slots: <b>Alt + 1 … 9</b> (or <b>;1 … ;9</b> while correcting) makes a slot the speaker of a paragraph. The label is written the way this style writes it (${esc(L.personLabel(p, { title: 'MR', name: 'Smith' }))}). Nobody is matched to a voice unless you say so here.</p>`
      + `<table class="lgt"><thead><tr><th>Slot</th><th>Who</th><th>Surname</th><th>Appears for</th><th>Is this voice in the transcript</th></tr></thead><tbody>`
      + p.fixed.map((role, k) => `<tr><td><kbd>${k + 1}</kbd></td><td>${esc((L.CAT.get(role) || {}).name || role)}</td><td colspan="2"><input data-role="${role}" value="${esc(L.roleLabel(p, g, role))}" aria-label="Label for the ${esc((L.CAT.get(role) || {}).name || role)}"></td><td>${voiceSel(voices, `r${role}`)}</td></tr>`).join('')
      + people.map((x, k) => `<tr><td><kbd>${k + 1 + p.fixed.length}</kbd></td><td><select data-pt="${k}" aria-label="Title, slot ${k + 1 + p.fixed.length}">${p.titleList.map(t => `<option value="${t}"${x.title === t ? ' selected' : ''}>${esc(p.titles[t])}</option>`).join('')}</select></td><td><input data-pn="${k}" value="${esc(x.name)}" placeholder="Surname" aria-label="Surname, slot ${k + 1 + p.fixed.length}"></td><td><input data-pp="${k}" value="${esc(x.party || '')}" placeholder="the plaintiff" aria-label="Appears for, slot ${k + 1 + p.fixed.length}"></td><td>${voiceSel(voices, `p${k}`)}</td></tr>`).join('')
      + `</tbody></table><label class="lgpn-f"><span>The recording began at (time of day, if you know it)</span><input data-start value="${esc(g.start || '')}" placeholder="9:44 a.m." size="12"><small>Used only to offer a time of day in inserts such as a recess. It is always shown for you to check; left empty, you type the time yourself.</small></label>`
      + (p.qa.layout !== 'letters' ? `<label class="lgpn-f"><span>Questions and answers in the saved text</span><select data-qal><option value="">Named speakers (MR X: … / WITNESS: …)</option><option value="dash"${g.qaLayout === 'dash' ? ' selected' : ''}>Answer after three dashes (… is that correct? --- Yes.)</option></select></label>` : '')
      + `<div class="lgpn-a"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`, true);
    el.querySelector('[data-save]').addEventListener('click', async () => {
      const before = slots().map(s => s.label), map = [];
      const neu = people.map((x, k) => ({ title: el.querySelector(`[data-pt="${k}"]`).value, name: el.querySelector(`[data-pn="${k}"]`).value.trim(), party: el.querySelector(`[data-pp="${k}"]`).value.trim() }));
      let last = neu.length; while (last > 0 && !neu[last - 1].name) last--;
      const roles = Object.assign({}, g.roles); for (const i of el.querySelectorAll('[data-role]')) { const v = i.value.trim().toUpperCase(); if (v && v !== p.roles[i.dataset.role]) roles[i.dataset.role] = v; else delete roles[i.dataset.role]; }
      const start = el.querySelector('[data-start]').value.trim(), qal = el.querySelector('[data-qal]');
      if (start && !L.clockAt(start, 0)) { el.querySelector('[data-start]').focus(); return toast('Write the time like 9:44 a.m. or 09:44, or leave it empty.', 5000); }
      closePanel();
      await change(() => {
        g.people = neu.slice(0, last); g.roles = roles; if (start) g.start = start; else delete g.start; if (qal) { if (qal.value) g.qaLayout = qal.value; else delete g.qaLayout; }
        const after = slots().map(s => s.label);
        after.forEach((a, k) => { if (before[k] && a && before[k] !== a) map.push([before[k], a]); });
        p.fixed.forEach((role, k) => { const v = el.querySelector(`[data-voice="r${role}"]`).value; if (v && after[k]) map.push([v, after[k]]); });
        neu.forEach((x, k) => { const v = el.querySelector(`[data-voice="p${k}"]`).value, s = after[k + p.fixed.length]; if (v && x.name && s) map.push([v, s]); });
        for (const [a, b] of map) if (a !== b) r.words = r.words.map(w => (w.sp === a ? { ...w, sp: b } : w.lg && w.lg.ex && w.lg.ex.by === a ? { ...w, lg: { ...w.lg, ex: { ...w.lg.ex, by: b } } } : w));
        for (const v of r.voices || []) { const m = map.find(x => x[0] === v.name); if (m) v.name = m[1]; }
      });
      toast(map.length ? `Saved. ${map.map(([a, b]) => `“${a}” is now ${b}`).join('; ')}. Ctrl + Z undoes.` : 'Saved.', 6000);
    });
  }
  const voiceSel = (voices, key) => (voices.length ? `<select data-voice="${key}" aria-label="Voice in the transcript"><option value="">—</option>${voices.map(v => `<option value="${esc(v)}">${esc(v)}, everywhere</option>`).join('')}</select>` : '<select data-voice="' + key + '" disabled aria-label="No voices named yet"><option value="">—</option></select>');

  function wordingPanel() {
    const p = pre(), id = p.id, rows = P.CATALOG.filter(c => c.kind !== 'sp');
    const el = panel(`Wording and short codes · ${p.name}`, `<p class="lgpn-i">${esc(p.about || '')} Your changes are kept on this computer for this kind of work, and can be saved to a file and loaded on another. Clear the wording of an insert you never use and it leaves the list. <b>check</b> marks wording that is not from a published standard: compare it with a sample from your client.</p>`
      + `<div class="lgpn-a"><button class="btn sm" data-exp>Save my wording to a file…</button><button class="btn sm" data-imp>Load a wording file…</button><input type="file" accept=".json,application/json" hidden data-impf><span class="sp"></span><button class="btn sm" data-reset>Back to the built-in wording</button></div>`
      + P.GROUPS.filter(g => rows.some(c => c.group === g)).map(g => `<h3>${esc(g)}</h3><table class="lgt lgwt"><tbody>${rows.filter(c => c.group === g).map(c => { const w = p.wording[c.as || c.id], code = p.codes[c.id] || c.code; return `<tr><td class="nm">${esc(c.name)}${p.unsourced.has(c.as || c.id) && w != null ? ' <i>check</i>' : ''}</td><td><span class="semi">;</span><input class="cd" data-code="${c.id}" value="${esc(code)}" size="5" aria-label="Short code for ${esc(c.name)}" autocomplete="off" spellcheck="false"></td><td class="wd">${c.as ? `<span class="muted">the wording of “${esc((L.CAT.get(c.as) || {}).name)}”</span>` : c.noHeading ? '<span class="muted">no heading is written</span>' : `<input data-word="${c.id}" value="${esc(w ?? '')}" placeholder="not used in this kind of work" aria-label="Wording for ${esc(c.name)}" autocomplete="off" spellcheck="false">`}</td></tr>`; }).join('')}</tbody></table>`).join('')
      + `<p class="lgpn-i">In the wording: {n} {desc} {party} {name} {by} {clock} {date} are asked for when you insert; in capitals ({NAME}) they are written in capitals; {time} is the place in the recording; [[ … ]] is left out when its value is empty.</p>`, true);
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.dataset.code) { const v = t.value.trim().toLowerCase().replace(/^;/, ''), c = L.CAT.get(t.dataset.code), clash = P.CATALOG.some(x => x.id !== c.id && (dev.codes[x.id] || x.code) === v); if (!/^[a-z0-9]{1,6}$/.test(v) || clash || /^[1-9]$/.test(v)) { t.value = dev.codes[c.id] || c.code; return toast(/^[1-9]$/.test(v) ? ';1 to ;9 are the speaker slots.' : 'A code is 1 to 6 letters or digits, and no two inserts share one.', 5000); } if (v === c.code) delete dev.codes[c.id]; else dev.codes[c.id] = v; saveDev(); toast(`;${v} now inserts “${c.name}”.`, 2500); }
      else if (t.dataset.word) { const k = t.dataset.word, v = t.value.trim(), mineW = dev.wording[id] || (dev.wording[id] = {}), built = L.preset(id, null).wording[k]; if ((v || null) === (built ?? null)) delete mineW[k]; else mineW[k] = v || null; saveDev(); toast(v ? 'Wording saved.' : 'That insert is now left out of this kind of work.', 2500); }
    });
    el.querySelector('[data-exp]').addEventListener('click', () => api.dl(JSON.stringify({ format: 'mixtape.legal-wording/1', wording: dev.wording, codes: dev.codes }, null, 1), 'mixtape legal wording.json'));
    el.querySelector('[data-imp]').addEventListener('click', () => el.querySelector('[data-impf]').click());
    el.querySelector('[data-impf]').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; try { const j = JSON.parse(await f.text()); if (j.format !== 'mixtape.legal-wording/1') throw new Error('it is not a Mixtape legal wording file'); const w = {}, cds = {}; for (const [pid, t] of Object.entries(j.wording || {})) if (P.PRESETS[pid] && t && typeof t === 'object') { w[pid] = {}; for (const [k, v] of Object.entries(t)) if (L.CAT.has(k) && (v === null || typeof v === 'string')) w[pid][k] = v === null ? null : v.slice(0, 400); } for (const [k, v] of Object.entries(j.codes || {})) if (L.CAT.has(k) && typeof v === 'string' && /^[a-z0-9]{1,6}$/.test(v) && !/^[1-9]$/.test(v)) cds[k] = v; dev.wording = w; dev.codes = cds; saveDev(); wordingPanel(); toast('Your wording and codes were loaded.'); } catch (err) { toast(`Could not load it: ${err.message || err}`, 6000); } });
    el.querySelector('[data-reset]').addEventListener('click', () => { if (!confirm(`Put the built-in wording back for “${p.name}”? Your changes to this kind of work are removed. Your short codes stay.`)) return; delete dev.wording[id]; saveDev(); wordingPanel(); });
  }

  function coverPanel() {
    const g = lg(); if (!g) return; const p = pre(), cv = g.cover || {}, ct = g.cert || {};
    const el = panel('Cover, certificate and page', (p.cover.length ? `<h3>Cover</h3><p class="lgpn-i">Printed at the top of the legal text, only the lines you fill in. The appearances come from Appearances and speakers.</p>${p.cover.map(f => `<label class="lgpn-f row"><span>${esc(f)}</span><input data-cv="${esc(f)}" value="${esc(cv[f] || '')}"></label>`).join('')}` : '<p class="lgpn-i">This kind of work has no cover: the company adds its own.</p>')
      + `<h3>Certificate</h3><p class="lgpn-i">Nothing is chosen for you, and nothing is signed for you. A certificate says what you did; it must be true of you and of this job. The certificate of a deposition officer (witness duly sworn, read and sign) belongs to the officer who took the deposition and is not offered. Leave credential numbers out unless you hold them.</p>`
      + `<div class="lgcerts" role="radiogroup" aria-label="Certificate"><label><input type="radio" name="lgc" value=""${!ct.id ? ' checked' : ''}> No certificate</label>`
      + (p.certs || []).map(c => `<label><input type="radio" name="lgc" value="${c.id}"${ct.id === c.id ? ' checked' : ''}${c.needs && ct.id !== c.id ? ' disabled' : ''}> ${esc(c.name)}${c.needs ? `<span class="lgneed"><input type="checkbox" data-need="${c.id}"${ct.id === c.id ? ' checked' : ''}> ${esc(c.needs)}</span>` : ''}</label>`).join('')
      + `<label><input type="radio" name="lgc" value="own"${ct.id === 'own' ? ' checked' : ''}> My own wording</label></div>`
      + `<label class="lgpn-f"><span>Certificate wording (yours to change)</span><textarea data-ctext rows="4">${esc(ct.text || '')}</textarea></label><label class="lgpn-f row"><span>Transcriber’s name, as typed</span><input data-cname value="${esc(ct.name || '')}"></label><label class="lgpn-f row"><span>Date</span><input data-cdate value="${esc(ct.date || '')}"></label>`
      + `<h3>Page</h3><label class="lgpn-f row"><span>Lines on a numbered page</span><input data-lines type="number" min="10" max="60" value="${g.lines || p.page.lines}" size="4"><small>${p.page.lines} is this style’s usual; some courts want another (28 in some US state courts).</small></label>`
      + `<div class="lgpn-a"><span class="sp"></span><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`, true);
    const txt = el.querySelector('[data-ctext]');
    el.addEventListener('change', e => { const t = e.target; if (t.dataset.need) { const rd = el.querySelector(`input[name="lgc"][value="${t.dataset.need}"]`); rd.disabled = !t.checked; if (!t.checked && rd.checked) { el.querySelector('input[name="lgc"][value=""]').checked = true; txt.value = ''; } } else if (t.name === 'lgc') { const c = (p.certs || []).find(x => x.id === t.value); if (c) txt.value = c.text; else if (!t.value) txt.value = ''; } });
    el.querySelector('[data-save]').addEventListener('click', async () => {
      const id = (el.querySelector('input[name="lgc"]:checked') || {}).value || '', cover = {}; for (const i of el.querySelectorAll('[data-cv]')) if (i.value.trim()) cover[i.dataset.cv] = i.value.trim();
      g.cover = cover; g.cert = id && txt.value.trim() ? { id, text: txt.value.trim(), name: el.querySelector('[data-cname]').value.trim(), date: el.querySelector('[data-cdate]').value.trim() } : null;
      const n = +el.querySelector('[data-lines]').value; if (n >= 10 && n <= 60 && n !== p.page.lines) g.lines = n; else delete g.lines;
      closePanel(); await api.save(); toast(g.cert ? 'Saved. The certificate is printed at the end of the legal text, with the name as you typed it.' : 'Saved. No certificate is printed.', 5000);
    });
  }

  const go = i => { closePanel(); const w = $(`#text .w[data-i="${i}"]`); if (w) { w.scrollIntoView({ block: 'center' }); flash(i); const t = tr().words[i].s; if (t != null) { api.cur.media.currentTime = Math.max(0, t - 1); } } };
  function indexPanel() {
    const r = tr(), evs = L.events(r.words), rows = L.exhibitRows(evs), at = e => (e ? `<button class="lgjump" data-go="${e.i}" title="Go there">${T.short(e.at)}</button>` : '—');
    const el = panel('Exhibits and witnesses', `<p class="lgpn-i">Built from your inserts and nothing else: take an insert out of the transcript and it leaves the index. Times are places in the recording; the numbered-pages file gives page and line.</p>`
      + `<h3>Exhibits</h3>${rows.length ? `<table class="lgt"><thead><tr><th>Exhibit</th><th>Description</th><th>Marked</th><th>Received</th><th>Also</th></tr></thead><tbody>${rows.map(x => `<tr><td>${esc(`${x.party ? x.party + ' ' : ''}Exhibit ${x.n}`)}</td><td>${esc(x.desc || '')}</td><td>${at(x.marked)}</td><td>${at(x.received)}</td><td>${x.other.map(o => `${esc(o.ev)} ${at(o)}`).join(', ')}</td></tr>`).join('')}</tbody></table>` : '<p class="lgpn-i">No exhibits yet. Insert ▾ → Exhibits, or <b>;exm</b> while correcting.</p>'}`
      + `<h3>Witnesses</h3>${evs.witnesses.length || evs.loose.length ? `<table class="lgt"><thead><tr><th>Witness</th><th>Examination</th><th>By</th><th>At</th></tr></thead><tbody>${evs.witnesses.map(w => `<tr><td><b>${esc(String(w.name).toUpperCase())}</b>${w.oath ? ` (${esc(w.oath)})` : ''}${w.party ? `<br><small>${esc(w.party)} witness</small>` : ''}</td><td></td><td></td><td>${at(w)}</td></tr>${w.exams.map(e => `<tr><td></td><td>${esc(e.col)}</td><td>${esc(e.by)}</td><td>${at(e)}</td></tr>`).join('')}`).join('')}${evs.loose.map(e => `<tr><td><small>no witness noted above it</small></td><td>${esc(e.col)}</td><td>${esc(e.by)}</td><td>${at(e)}</td></tr>`).join('')}</tbody></table>` : '<p class="lgpn-i">No witnesses yet. Insert ▾ → Witness, or <b>;sw</b> while correcting.</p>'}`
      + `<div class="lgpn-a"><span class="sp"></span><button class="btn" data-copy>Copy</button><button class="btn" data-file>Save as a file (.txt)</button></div>`, true);
    const text = () => L.indexText(r.words, pre(), e => T.short(e.at));
    el.addEventListener('click', async e => { const g = e.target.closest('[data-go]'); if (g) return go(+g.dataset.go); if (e.target.closest('[data-copy]')) { try { await navigator.clipboard.writeText(text()); toast('The index is copied.'); } catch (err) { toast('Could not copy it here. Save it as a file instead.', 5000); } } else if (e.target.closest('[data-file]')) api.dl(mark(text()), base() + ' (index).txt'); });
  }
  function checkPanel(then) {
    const r = tr(), items = L.check(r.words, pre());
    const el = panel('Check before saving', (items.length ? `<p class="lgpn-i">Things to look at. None of them stops you saving.</p>${items.map(it => `<div class="lgck"><b>${it.n}</b> ${esc(it.what)}<div class="lgck-j">${it.at.slice(0, 60).map(i => `<button class="lgjump" data-go="${i}">${T.short(r.words[i].s || 0)}</button>`).join('')}${it.at.length > 60 ? ` and ${it.at.length - 60} more` : ''}</div></div>`).join('')}` : '<p class="lgpn-i">Nothing to look at: no inaudible tags, no exhibit left unreceived, no name still marked phonetic, questions and answers in order.</p>')
      + `<div class="lgpn-a"><span class="sp"></span>${then ? '<button class="btn primary" data-then>Save the file anyway</button>' : ''}</div>`, true);
    el.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) return go(+g.dataset.go); if (e.target.closest('[data-then]')) { closePanel(); then(); } });
  }

  /* ---------- saving as a file ---------- */
  const sens = () => api.sensitive(api.cur.track.id);
  const mark = t => (sens() ? api.SENS_LINE + '\n\n' + t : t);
  const base = () => (api.cur.track.title || 'transcript').replace(/[\\/:*?"<>|]+/g, '-') + (sens() ? ' (SENSITIVE)' : '');
  const json = r => JSON.stringify({ title: api.cur.track.title, mode: r.mode, ...(sens() ? { sensitive: true } : {}), ...(r.legal ? { legal: r.legal } : {}), words: r.words }, null, 1);
  function exportMenu(anchor, items, opt) {
    const r = tr(); if (!r || !r.legal) return api.menu(anchor, items, opt);
    if (!on()) return api.menu(anchor, items.map(it => (/^Words with times/.test(it[0]) ? [it[0], () => api.dl(json(r), base() + '.json')] : it)), opt);
    const p = pre(), g = lg(), n = L.check(r.words, p).reduce((s, x) => s + x.n, 0), timed = () => L.spoken(r.words.slice(0, T.timedUpTo(r.words)));
    const pages = () => { const pg = L.toPages(r.words, g, p, { lines: g.lines }); return pg.text + '\f\n' + L.indexText(r.words, p, e => pg.refs.get(e.i) || '--'); };
    api.menu(anchor, [[`Legal transcript · ${p.name}`, null],
      [n ? `Check before saving (${n} to look at)…` : 'Check before saving…', () => checkPanel()],
      ['Legal text (.txt)', () => api.dl(mark(L.toTxt(r.words, g, p)), base() + ' (legal).txt')],
      ['Legal text with times (.txt)', () => api.dl(mark(L.toTxt(r.words, g, p, { stamps: true })), base() + ' (legal, times).txt')],
      [`Numbered pages, ${g.lines || p.page.lines} lines, with the index (.txt)`, () => api.dl(mark(pages()), base() + ' (legal, pages).txt')],
      ['Exhibit and witness index (.txt)', () => api.dl(mark(L.indexText(r.words, p, e => T.short(e.at))), base() + ' (index).txt')],
      ['Subtitles: speech only, notations left out (.srt)', () => api.dl(T.toSrt(timed()), base() + '.srt')],
      ['Web subtitles: speech only (.vtt)', () => api.dl(sens() ? T.toVtt(timed()).replace(/^WEBVTT[^\n]*\n+/, m => m.trimEnd() + '\n\nNOTE ' + api.SENS_LINE + '\n\n') : T.toVtt(timed()), base() + '.vtt')],
      ['Words with times and legal marks (.json)', () => api.dl(json(r), base() + '.json')],
      ...items.slice(-2)], opt);
  }
  /* a .json opened here: the legal marks and settings come back with it */
  function imported(t, ra) {
    try {
      if (!t || !ra || !Array.isArray(ra.words)) return;
      ra.words.forEach((w, i) => { if (w && w.lg && typeof w.lg === 'object' && t.words[i]) t.words[i].lg = JSON.parse(JSON.stringify(w.lg)); });
      if (ra.legal && typeof ra.legal === 'object') { t.legal = JSON.parse(JSON.stringify(ra.legal)); if (!P.PRESETS[t.legal.preset]) t.legal.preset = P.DEFAULT; }
    } catch (e) { console.warn('legal:', e); }
  }
  /* a paragraph corrected in the box (called by app.js with what TranscriptCore.editParagraph made of it) */
  function edited(old, i0, i1, neu) {
    try {
      const pend = pending; pending = []; lastExp = null; escaped = null;
      let out = L.edited(old, i0, i1, neu, { on: on(), pending: pend, labels: on() ? labels() : [], witness: on() ? witness() : '' });
      if (on()) for (const p of pend) if (p.used && p.lg.ex) { const at = out.findIndex(w => w.lg === p.lg); if (at >= 0) out = L.flowQA(out, at, p.lg.ex.by, witness()); }
      return out;
    } catch (e) { console.warn('legal:', e); return neu; }
  }

  /* ---------- keys and clicks ---------- */
  document.addEventListener('keydown', e => {
    if (!tr() || e.isComposing) return; const ctrl = e.ctrlKey || e.metaKey, inMine = e.target.closest && e.target.closest('.lgpal, .lgform, .lgpanel'), ta = e.target.closest && e.target.closest('#text .edit textarea');
    if (ctrl && !e.altKey && e.key === '.') { e.preventDefault(); e.stopPropagation(); if (panelEl) return; if (!on()) return legalMenu(); return palette(pal ? null : origin(ta || editBox())); }
    if (!on() || inMine) return;
    if (e.altKey && !ctrl && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); e.stopPropagation(); if (!ta && e.target.closest('input, textarea, select')) return; return insert({ slot: +e.code.slice(5) }, origin(ta)); }
    if (e.altKey && !ctrl && e.code === 'KeyQ') { e.preventDefault(); e.stopPropagation(); if (ta) return qaInBox(ta); if (e.target.closest('input, textarea, select')) return; return toggleQA(null, e.shiftKey); }
    if (!ta || ctrl || e.altKey) { if (ta && ctrl && (e.key === 'z' || e.key === 'Z') && lastExp && lastExp.ta === ta && ta.value === lastExp.after) { e.preventDefault(); e.stopPropagation(); unexpand(); } return; }
    if (e.key === 'Backspace' && lastExp && lastExp.ta === ta && ta.value === lastExp.after && ta.selectionStart === lastExp.caret && ta.selectionEnd === lastExp.caret) { e.preventDefault(); e.stopPropagation(); return unexpand(); }
    if ((e.key === ' ' || e.key === 'Enter') && !e.shiftKey && ta.selectionStart === ta.selectionEnd) {
      const c = L.codeAt(ta.value, ta.selectionStart); if (!c || (escaped && escaped.ta === ta && escaped.pos === c.start)) return;
      const item = /^[1-9]$/.test(c.code) ? { slot: +c.code } : codes().get(c.code); if (!item) return;
      e.preventDefault(); e.stopPropagation(); insert(item, { ta, start: c.start, end: ta.selectionStart, typed: ';' + c.code, trigger: e.key });
    }
  }, true);
  function unexpand() { const x = lastExp, ta = x.ta; lastExp = null; if (x.pend) pending = pending.filter(p => p !== x.pend); mine = true; ta.focus(); ta.setSelectionRange(0, ta.value.length); try { if (!document.execCommand('insertText', false, x.before)) ta.value = x.before; } catch (e) { ta.value = x.before; } mine = false; const c = x.start + x.typed.length; ta.setSelectionRange(c, c); escaped = { ta, pos: x.start }; hintNear(ta, `${x.typed} is back as you typed it`); }
  document.addEventListener('input', e => {
    const ta = e.target.closest && e.target.closest('#text .edit textarea'); if (!ta || mine || !on()) return;
    if (lastExp && ta.value !== lastExp.after) lastExp = null;
    if (escaped && escaped.ta === ta && ta.value[escaped.pos] !== ';') escaped = null; /* the code that was put back has been deleted: a new code typed there expands as usual */
    const c = ta.selectionStart; // ;; is a semicolon that stays a semicolon
    if (e.inputType === 'insertText' && e.data === ';' && ta.value.slice(c - 2, c) === ';;' && (c < 3 || /[\s(\[“"']/.test(ta.value[c - 3]))) { put(ta, c - 2, c, ';'); escaped = { ta, pos: c - 2 }; }
    else if (e.inputType === 'insertText' && e.data === ' ' && ta.selectionEnd === c) { // a keyboard that sends no key press (a phone): the space itself is the trigger. Pasted text never expands.
      const k = L.codeAt(ta.value, c - 1); if (!k || (escaped && escaped.ta === ta && escaped.pos === k.start)) return;
      const item = /^[1-9]$/.test(k.code) ? { slot: +k.code } : codes().get(k.code); if (item) insert(item, { ta, start: k.start, end: c, typed: ';' + k.code, trigger: ' ' });
    }
  }, true);
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-lg]'); if (!b || !tr()) return; const a = b.dataset.lg, ta = editBox(); lastBtn = b;
    if (a === 'menu') legalMenu(b);
    else if (a === 'insert') palette(origin(b.closest('.edit') ? ta : null));
    else if (a === 'slot') insert({ slot: +b.dataset.n }, origin(ta));
    else if (a === 'people') appearances();
    else if (a === 'qa') { if (ta) qaInBox(ta); else toggleQA(null, e.shiftKey); }
    else if (a === 'qaAt') { if (api.editing) return toast('Save or cancel the paragraph you are correcting first.'); toggleQA(+b.closest('.para').dataset.i0, e.shiftKey); }
    else if (a === 'index') indexPanel();
    else if (a === 'check') checkPanel();
  });
  addEventListener('resize', () => { closePalette(); closeForm(); });

  api.KEYS.push(['Ctrl + .', 'Legal: the list of inserts — type to filter, Enter inserts (also the Insert button)'], [';code then Space', 'Legal, while correcting: insert by short code (;ina inaudible, ;exm exhibit, ;dx direct…). ;; types a semicolon. Backspace straight after puts the code back'], ['Alt + 1 … 9', 'Legal: make a speaker slot the speaker of the paragraph (;1 … ;9 while correcting)'], ['Alt + Q', 'Legal: switch a paragraph between question and answer (with Shift: all that follow too)']);
  watch(); decorate();
  const out = { edited, imported, exportMenu, palette, insert, on, pre, ins };
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__legal = Object.assign({ L, P, dev, setOn, setPreset, get pending() { return pending; } }, out);
  return out;
}
