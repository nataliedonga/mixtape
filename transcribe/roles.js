/* Mixtape transcripts: "who is who", from the words alone (../roles-core.js). No AI, nothing sent anywhere.

   What the words show is put straight onto the transcript, once, when it is finished: the numbered speaker who answers
   becomes THE WITNESS (or the name the examiner greets them by), the one who asks becomes EXAMINING COUNSEL, the one who
   says the court's words becomes THE COURT; and, in a legal transcript, a notation goes in where an exhibit is offered,
   a witness is sworn, a recess is taken or the record stops. A person then goes over it: everything set this way is
   highlighted in the text and listed in a bar above it, each with its evidence, a Keep and an Undo. Ctrl + Z undoes
   the lot. A voice that sounds like two people cannot be put right by rule, so it is only pointed at. */
import { suggest } from '../roles-core.js';
import { styleOf } from './matter.js';
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let api, bar, open = true, lastKey = '', busy = false;
const STYLE = `
#rolesBar { margin: 0 0 10px; padding: 10px 12px; border: 1px solid var(--faint, #8884); border-radius: 10px; background: var(--sheet, transparent); font: 14px/1.45 var(--f-ui, system-ui, sans-serif); }
#rolesBar[hidden] { display: none; }
#rolesBar .rh { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; } #rolesBar .rh b { font-weight: 650; } #rolesBar .rh small { color: var(--muted, inherit); opacity: .85; } #rolesBar .rh .sp { flex: 1; }
#rolesBar ul { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 6px; max-height: 34vh; overflow: auto; }
#rolesBar li { display: flex; align-items: center; gap: 8px 12px; padding: 6px 8px; border-radius: 8px; background: color-mix(in srgb, #e6b800 16%, transparent); }
#rolesBar li.point { background: color-mix(in srgb, var(--accent, #1f6f78) 9%, transparent); }
#rolesBar li .tx { flex: 1; min-width: 0; } #rolesBar li .acts { display: flex; gap: 6px; flex: none; }
#rolesBar li .who { font-weight: 650; } #rolesBar li .why { display: block; color: var(--muted, inherit); font-size: 13px; }
#rolesBar button { height: 30px; padding: 0 10px; border: 1px solid var(--faint, #888); border-radius: 7px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
#rolesBar button.yes { background: var(--accent, #1f6f78); border-color: var(--accent, #1f6f78); color: var(--accent-ink, #fff); font-weight: 650; }
#rolesBar button:focus-visible { outline: 2px solid var(--accent, currentColor); outline-offset: 1px; }
#rolesBar .unsure { font-size: 12px; padding: 1px 6px; border-radius: 999px; border: 1px solid currentColor; opacity: .75; }
#text .para .spk.rauto { background: color-mix(in srgb, #e6b800 38%, transparent); border-radius: 5px; box-shadow: 0 0 0 2px color-mix(in srgb, #e6b800 38%, transparent); }
#text .para.rautoins { background: color-mix(in srgb, #e6b800 22%, transparent); border-radius: 6px; }
@media (max-width: 640px) { #rolesBar li { flex-wrap: wrap; } #rolesBar li .tx { flex-basis: 100%; } }`;
const short = t => { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60, p = n => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : m) + ':' + p(s); };
const ROLE = { court: ['THE COURT', 'the court'], witness: ['THE WITNESS', 'the witness'], examiner: ['EXAMINING COUNSEL', 'asks the questions'] };
const T = () => window.TranscriptCore, L = () => window.LegalCore;
const numbered = l => /^Speaker \d+$/.test(l);
const autoIns = words => { const out = []; words.forEach((w, i) => { if (w.lg && w.lg.auto) { let n = 1; while (i + n < words.length && !words[i + n].p) n++; out.push({ i, n, s: w.s, text: words.slice(i, i + n).map(x => x.t).join(' '), quote: w.lg.auto }); } }); return out; };

/* once per transcript: what the words show goes onto it */
async function applyAuto() {
  const c = api.cur, r = c.tr; if (!r || r.auto || r.mode !== 'heard' || !r.done || !r.words.length || api.job) return;
  const sg = suggest(r.words, styleOf(r)), todo = sg.roles.filter(x => x.role && x.role !== 'mixed' && numbered(x.label));
  const legal = !!(r.legal && r.legal.on && L() && !(r.notes && r.notes.length) && !r.review), ins = legal ? sg.inserts.filter(x => x.text) : []; // notations only in a legal transcript, and only while nothing else is pinned to word numbers
  if (!todo.length && !ins.length) return;
  busy = true; api.remember(); const auto = { at: Date.now(), names: [] }, taken = new Set(T().speakerNames(r.words));
  for (const x of todo) {
    let to = x.role === 'witness' && x.name ? x.name : ROLE[x.role][0]; for (let k = 2; taken.has(to); k++) to = `${x.role === 'witness' && x.name ? x.name : ROLE[x.role][0]} ${k}`;
    taken.add(to); r.words = T().renameSpeaker(r.words, r.voices, x.label, to); auto.names.push({ from: x.label, to, role: x.role, sure: !!x.sure, why: x.evidence.join('; ') });
  }
  for (const x of [...ins].sort((a, b) => b.end - a.end)) r.words = L().insertBlock(r.words, x.end, x.text, { k: 'n', auto: x.quote }, x.s).words; // from the end back, so the places stay true
  r.auto = auto;
  try { await api.save(); } catch (e) { busy = false; return; }
  busy = false; api.drawAll();
  const n = auto.names.length + ins.length; api.toast(`Set from the words: ${n} thing${n === 1 ? '' : 's'}, highlighted in the text. Check them in the bar above the transcript. Ctrl + Z undoes all of it.`, 9000);
}
function state() {
  const c = api.cur; if (!c || !c.tr || c.tr.mode !== 'heard' || !c.tr.done || !c.tr.words.length) return null;
  const r = c.tr, sg = suggest(r.words, styleOf(r)), sn = r.rolesSeen || { no: [], ins: [] }, have = new Set(T().speakerNames(r.words));
  const names = ((r.auto && r.auto.names) || []).filter(n => have.has(n.to)), put = autoIns(r.words);
  const mixed = sg.roles.filter(x => x.role === 'mixed' && numbered(x.label) && !sn.no.includes(x.label + ':mixed'));
  const legal = !!(r.legal && r.legal.on); // outside a legal transcript, and where the style has no wording for it, a place is only pointed at
  const points = sg.inserts.filter(x => (!legal || !x.text) && !sn.ins.includes(x.kind + '@' + x.i));
  return names.length || put.length || mixed.length || points.length ? { names, put, mixed, points } : null;
}
function mark(o) { // the highlight in the text: the names set from the words, and the notations put in
  const set = new Set(o ? o.names.map(n => n.to) : []), why = new Map(o ? o.names.map(n => [n.to, n.why]) : []);
  for (const b of document.querySelectorAll('#text .para [data-spk]')) { const name = b.firstChild && b.firstChild.nodeType === 3 ? b.firstChild.nodeValue.trim() : b.textContent.trim(), on = set.has(name); b.classList.toggle('rauto', on); if (on) b.title = `Set from the words (${why.get(name)}). Click to change it.`; }
  const at = new Set(o ? o.put.map(x => String(x.i)) : []); for (const p of document.querySelectorAll('#text .para')) p.classList.toggle('rautoins', at.has(p.dataset.i0));
}
function draw() {
  if (busy) return; const c = api.cur;
  if (c && c.tr && !c.tr.auto && !api.job && c.tr.done && c.tr.mode === 'heard') { applyAuto(); if (busy) return; }
  const o = c && !api.job ? state() : null; mark(o);
  const key = JSON.stringify(o) + open; if (key === lastKey) return; lastKey = key;
  if (!o) { bar.hidden = true; bar.textContent = ''; return; }
  const n = o.names.length + o.put.length + o.mixed.length + o.points.length, done = o.names.length + o.put.length;
  const tag = sure => (sure ? '' : ' <span class="unsure" title="The pattern is there but thin: look at this one first">likely</span>');
  const name = (x, k) => `<li><span class="who">${esc(x.from)} → ${esc(x.to)}</span>${tag(x.sure)}<span class="why">${esc(x.why)}.${x.role === 'examiner' ? ' Click the name in the text to put counsel’s own name.' : ''}</span><button class="yes" data-rkeep="${k}" title="It is right: take the highlight off">Keep</button><button data-rundo="${k}" title="Put ${esc(x.from)} back">Undo</button></li>`;
  const put = x => `<li><span class="who">${short(x.s)}</span> ${esc(x.text)} was put in<span class="why">Heard: “…${esc(x.quote)}…”.</span><button data-rgo="${x.i}" title="Go to this place and play it">Go there</button><button class="yes" data-rikeep="${x.i}" title="It is right: take the highlight off">Keep</button><button data-riundo="${x.i}" title="Take this notation out again">Undo</button></li>`;
  const mixed = r => `<li class="point"><span class="who">${esc(r.label)}</span> sounds like two people<span class="why">${esc(r.evidence.join('; '))}. Fast exchanges are sometimes heard as one voice, and no rule can split them: go through its paragraphs and set the right speaker on each.</span><button data-rgo="${r.mixedAt[0]}" title="Go to the first place">Show me</button><button data-rno="${esc(r.label)}:mixed" title="Put this away" aria-label="Put this away">✕</button></li>`;
  const point = x => `<li class="point"><span class="who">${short(x.s)}</span> ${esc(x.say)}<span class="why">Heard: “…${esc(x.quote)}…”. ${x.text ? 'This is not a legal transcript, so nothing was put in.' : 'The style in use has no notation for this, so nothing was put in.'}</span><button data-rgo="${x.i}" title="Go to this place and play it">Go there</button><button data-rino="${esc(x.kind + '@' + x.i)}" title="Put this away" aria-label="Put this away">✕</button></li>`;
  bar.hidden = false;
  bar.innerHTML = `<div class="rh"><b>Set from the words</b><small>${n} to check${done ? ' · highlighted in the text' : ''} · no AI, nothing leaves this computer</small><span class="sp"></span>${done > 1 ? '<button data-rkeepall title="They are all right: take every highlight off">Keep all</button>' : ''}<button data-rtoggle aria-expanded="${open}">${open ? 'Hide' : 'Show'}</button></div>`
    + (open ? `<ul>${o.names.map(name).join('')}${o.put.map(put).join('')}${o.mixed.map(mixed).join('')}${o.points.map(point).join('')}</ul>` : '');
  for (const li of bar.querySelectorAll('li')) { const acts = document.createElement('div'), tx = document.createElement('div'); acts.className = 'acts'; tx.className = 'tx'; acts.append(...li.querySelectorAll(':scope > button')); tx.append(...li.childNodes); li.append(tx, acts); } // the words on the left, the buttons together on the right
}
async function click(e) {
  const t = e.target.closest('button'); if (!t) return; const c = api.cur, r = c.tr, d = t.dataset;
  const done = async () => { try { await api.save(); } catch (err) { return; } lastKey = ''; api.drawAll(); draw(); };
  if ('rtoggle' in d) { open = !open; return draw(); }
  if (d.rgo != null) { const i = +d.rgo, w = r.words[i]; if (w && w.s != null && c.media) { c.media.currentTime = w.s; c.media.play().catch(() => {}); } const el = document.querySelector(`#text .para[data-i0="${i}"]`) || [...document.querySelectorAll('#text .para')].find(p => +p.dataset.i0 <= i && +p.dataset.i1 > i); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
  const live = () => { const have = new Set(T().speakerNames(r.words)); return r.auto.names.filter(n => have.has(n.to)); };
  if ('rkeepall' in d) { r.auto.names = []; r.words = r.words.map(w => (w.lg && w.lg.auto ? { ...w, lg: (({ auto, ...g }) => g)(w.lg) } : w)); return done(); }
  if (d.rkeep != null || d.rundo != null) {
    const x = live()[+(d.rkeep ?? d.rundo)]; if (!x) return;
    if (d.rundo != null) { if (T().speakerNames(r.words).includes(x.from)) return api.toast(`“${x.from}” is in use again, so this cannot be put back. Click the name in the text to change it.`, 6000); api.remember(); r.words = T().renameSpeaker(r.words, r.voices, x.to, x.from); if (x.role === 'voice') (r.voiceNo ||= []).push(x.from); /* not named by voice again */ }
    r.auto.names = r.auto.names.filter(n => n !== x); return done();
  }
  if (d.rikeep != null || d.riundo != null) {
    const i = +(d.rikeep ?? d.riundo), w = r.words[i]; if (!w || !w.lg || !w.lg.auto) return;
    if (d.riundo != null) { let n = 1; while (i + n < r.words.length && !r.words[i + n].p) n++; api.remember(); r.words = r.words.slice(0, i).concat(r.words.slice(i + n)); }
    else r.words = r.words.map((x, k) => (k === i ? { ...x, lg: (({ auto, ...g }) => g)(x.lg) } : x));
    return done();
  }
  if (d.rno || d.rino) { const s = (r.rolesSeen ||= { no: [], ins: [] }); if (d.rno) s.no.push(d.rno); else s.ins.push(d.rino); try { await api.save(); } catch (err) {} lastKey = ''; draw(); }
}
export function initRoles(a) {
  api = a; const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
  bar = document.createElement('section'); bar.id = 'rolesBar'; bar.hidden = true; bar.setAttribute('aria-label', 'What was set from the words: check each one'); $('#text').before(bar);
  bar.addEventListener('click', click);
  new MutationObserver(draw).observe($('#text'), { childList: true }); // at once, before the page is painted, so the text does not jump down a moment later
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__roles = { draw, state, suggest };
  draw();
}
