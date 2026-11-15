/* Mixtape transcripts: the matter a recording belongs to.

   A hearing arrives as many recordings. A matter ties them together, on this computer only:
   - the cast: the appearances and role wording set in Legal for one recording are there for the next;
   - the voices: a speaker you have named in one recording is recognised by voice in the others and named there,
     highlighted like everything else that is set automatically (see roles.js). A voiceprint is a list of numbers made
     from the sound of a voice; it is kept in this browser, only if you tick the box, and "Forget voices" removes it;
   - the style: whose conventions the automatic notations follow (Rev's legal guide, TranscribeMe's, or Mixtape's own).

   Nothing here leaves the computer, and nothing is matched across matters. */
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'mixtape-matters', SAME = 0.75, CLEAR = 0.15; // a voice is the same person at 0.75 alike or more, and only if the next best is 0.15 behind
export const STYLES = [['', 'Mixtape’s own'], ['rev', 'Rev, legal'], ['tm-clean', 'TranscribeMe, clean verbatim'], ['tm-full', 'TranscribeMe, full verbatim']];
let api, row, lastKey = '', busy = false;
const all = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
const put = m => { try { localStorage.setItem(KEY, JSON.stringify(m)); return true; } catch (e) { api.toast('The matter could not be saved on this device (its storage may be full).', 8000); return false; } };
const mine = () => { const c = api.cur, n = c && c.tr && c.tr.matter; return n ? all()[n] || null : null; };
export const styleOf = tr => { const m = tr && tr.matter ? all()[tr.matter] : null; return (m && m.style) || ''; };
const T = () => window.TranscriptCore;
/* names that say a role, not a person: they are never remembered as a voice, and a recognised voice may replace them */
const generic = n => /^Speaker \d+$/i.test(n) || /^(THE WITNESS|EXAMINING COUNSEL)( \d+)?$/.test(n);
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const unit = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };

/* the voices named by a person in this recording are kept for the matter */
function learn(tr, m) {
  if (!m.remember || !Array.isArray(tr.voices)) return false; let changed = false; m.voices ||= [];
  const used = new Set(T().speakerNames(tr.words));
  for (const v of tr.voices) {
    if (!v || !v.c || generic(v.name) || !used.has(v.name)) continue;
    const had = m.voices.find(x => x.name === v.name), c = v.c.map(x => +x.toFixed(4));
    if (!had) { m.voices.push({ name: v.name, c, from: tr.id }); changed = true; }
    else if (had.from === tr.id && JSON.stringify(had.c) !== JSON.stringify(c)) { had.c = c; changed = true; }
  }
  return changed;
}
/* the voices of this recording that the matter already knows: [{ from, to, sim }] */
function known(tr, m) {
  const out = []; if (!m || !m.remember || !(m.voices || []).length || !Array.isArray(tr.voices)) return out;
  const used = new Set(T().speakerNames(tr.words)), taken = new Set([...used].filter(n => !generic(n)));
  for (const v of tr.voices) {
    if (!v || !v.c || !generic(v.name) || !used.has(v.name) || (tr.voiceNo || []).includes(v.name)) continue; // voiceNo: you undid this one
    const sims = m.voices.map(x => ({ name: x.name, sim: dot(unit(v.c), unit(x.c)) })).sort((a, b) => b.sim - a.sim);
    if (sims[0] && sims[0].sim >= SAME && (!sims[1] || sims[0].sim - sims[1].sim >= CLEAR) && !taken.has(sims[0].name)) { out.push({ from: v.name, to: sims[0].name, sim: sims[0].sim }); taken.add(sims[0].name); }
  }
  return out;
}
/* what the matter gives this recording, once it belongs to it (and again when the matter learns something new) */
async function apply() {
  const c = api.cur, tr = c && c.tr, name = tr && tr.matter; if (!tr || !name || api.job || busy || !tr.done) return;
  const ms = all(), m = ms[name]; if (!m) return; let touched = false, saved = false;
  // the cast: from the matter into a legal transcript that has none; from a transcript that has one into the matter
  const g = tr.legal;
  if (g && g.on) {
    const has = (g.people || []).some(p => p && String(p.name || '').trim());
    if (!has && (m.people || []).length) { g.people = JSON.parse(JSON.stringify(m.people)); g.roles = Object.assign({}, m.roles, g.roles); touched = true; }
    else if (has && JSON.stringify(g.people) !== JSON.stringify(m.people || [])) { m.people = JSON.parse(JSON.stringify(g.people)); m.roles = Object.assign({}, g.roles); saved = true; }
  }
  // the voices
  const got = known(tr, m);
  if (got.length) {
    busy = true; api.remember(); tr.auto ||= { at: Date.now(), names: [] };
    for (const k of got) { tr.words = T().renameSpeaker(tr.words, tr.voices, k.from, k.to); tr.auto.names = tr.auto.names.filter(n => n.to !== k.from); tr.auto.names.push({ from: k.from, to: k.to, role: 'voice', sure: k.sim >= 0.85, why: `the same voice as “${k.to}” in another recording of “${name}” (${Math.round(k.sim * 100)}% alike)` }); }
    touched = true;
  }
  if (learn(tr, m)) saved = true;
  if (saved) put(ms);
  if (touched) { try { await api.save(); } catch (e) { busy = false; return; } busy = false; api.drawAll(); if (got.length) api.toast(`${got.length} speaker${got.length === 1 ? '' : 's'} named by voice from “${name}”, highlighted in the text. Check them in the bar above the transcript.`, 8000); }
  busy = false;
}
function draw() {
  const c = api.cur, tr = c && c.tr; if (!tr || tr.mode !== 'heard') { row.hidden = true; lastKey = ''; return; }
  apply();
  const ms = all(), names = Object.keys(ms).sort((a, b) => a.localeCompare(b)), m = tr.matter ? ms[tr.matter] : null;
  if (lastKey === 'new' && $('#matterNew')) return; // a name is being typed
  const key = JSON.stringify([tr.id, tr.matter || '', names, m && [m.style, m.remember, (m.voices || []).map(v => v.name), (m.people || []).length]]); if (key === lastKey) return; lastKey = key;
  row.hidden = false;
  const voices = m ? (m.voices || []).map(v => v.name) : [];
  row.innerHTML = `<label for="matterSel">Matter</label><select id="matterSel" title="The case or job this recording belongs to. Its cast, its named voices and its style are shared by its recordings, on this computer only.">`
    + `<option value="">None</option>${names.map(n => `<option value="${esc(n)}"${n === tr.matter ? ' selected' : ''}>${esc(n)}</option>`).join('')}<option value="+">New matter…</option></select>`
    + (m ? `<label for="matterStyle">Style</label><select id="matterStyle" title="Whose conventions the automatic notations follow">${STYLES.map(([v, t]) => `<option value="${v}"${v === (m.style || '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      + `<label class="mchk" title="A voiceprint is a list of numbers made from the sound of a voice. It is kept in this browser only, to name the same person in this matter’s other recordings."><input type="checkbox" id="matterVoices"${m.remember ? ' checked' : ''}> Remember named voices</label>`
      + `<span class="mnote">${voices.length ? `Knows ${voices.length}: ${esc(voices.slice(0, 4).join(', '))}${voices.length > 4 ? '…' : ''}` : m.remember ? 'No voices yet: name a speaker here and it is remembered.' : ''}${(m.people || []).length ? ` · cast of ${m.people.filter(p => p && String(p.name || '').trim()).length}` : ''}</span>`
      + (voices.length ? `<button type="button" id="matterForget" title="Remove every voiceprint kept for this matter">Forget voices</button>` : '') : '<span class="mnote">Choose a matter to share a cast, named voices and a style between its recordings.</span>');
}
async function change(e) {
  const c = api.cur, tr = c.tr, ms = all(), id = e.target.id;
  if (id === 'matterSel') {
    let v = e.target.value;
    if (v === '+') { // typed in the row itself (a desktop app has no question box)
      row.innerHTML = `<label for="matterNew">New matter</label><input id="matterNew" type="text" maxlength="80" placeholder="Case name or number" autocomplete="off"><button type="button" id="matterMake">Create</button><button type="button" id="matterCancel">Cancel</button>`; lastKey = 'new'; $('#matterNew').focus(); return;
    }
    if (v) tr.matter = v; else delete tr.matter;
    try { await api.save(); } catch (err) { return; } lastKey = ''; draw(); api.drawAll(); return;
  }
  const m = ms[tr.matter]; if (!m) return;
  if (id === 'matterStyle') { m.style = e.target.value; put(ms); lastKey = ''; draw(); api.drawAll(); return; }
  if (id === 'matterVoices') { m.remember = e.target.checked; put(ms); lastKey = ''; draw(); if (m.remember) api.toast('Named voices in this matter are now remembered, in this browser only. “Forget voices” removes them.', 7000); }
}
export function initMatter(a) {
  api = a; const st = document.createElement('style');
  st.textContent = `#matterRow { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 0 0 10px; font: 13.5px/1.4 var(--f-ui, system-ui, sans-serif); }
#matterRow[hidden] { display: none; } #matterRow label { color: var(--muted, inherit); } #matterRow .mchk { display: inline-flex; align-items: center; gap: 6px; color: inherit; cursor: pointer; }
#matterRow select, #matterRow button, #matterRow input[type=text] { height: 30px; padding: 0 8px; border: 1px solid var(--faint, #888); border-radius: 7px; background: var(--sheet, transparent); color: inherit; font: inherit; max-width: 100%; }
#matterRow button { cursor: pointer; background: transparent; } #matterRow .mnote { color: var(--muted, inherit); font-size: 12.5px; }
#matterRow select:focus-visible, #matterRow button:focus-visible, #matterRow input:focus-visible { outline: 2px solid var(--accent, currentColor); outline-offset: 1px; }`;
  document.head.appendChild(st);
  row = document.createElement('section'); row.id = 'matterRow'; row.hidden = true; row.setAttribute('aria-label', 'The matter this recording belongs to'); $('#text').before(row);
  row.addEventListener('change', change);
  const make = async () => { const v = ($('#matterNew') ? $('#matterNew').value : '').trim(); if (!v) return $('#matterNew').focus(); const ms = all(); if (!ms[v]) { ms[v] = { style: '', remember: false, voices: [], people: [], roles: {} }; if (!put(ms)) return; } api.cur.tr.matter = v; try { await api.save(); } catch (err) { return; } lastKey = ''; draw(); api.drawAll(); };
  row.addEventListener('keydown', e => { if (e.target.id === 'matterNew') { if (e.key === 'Enter') make(); else if (e.key === 'Escape') { lastKey = ''; draw(); } e.stopPropagation(); } });
  row.addEventListener('click', e => { if (e.target.id === 'matterMake') return make(); if (e.target.id === 'matterCancel') { lastKey = ''; return draw(); } if (e.target.id !== 'matterForget') return; const ms = all(), m = ms[api.cur.tr.matter]; if (!m) return; const n = (m.voices || []).length; m.voices = []; m.remember = false; /* otherwise the open recording would put its named voices straight back */ put(ms); lastKey = ''; draw(); api.toast(`${n} voiceprint${n === 1 ? '' : 's'} removed from this matter, and remembering is switched off. Names already in transcripts stay.`, 7000); });
  let timer = 0; new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(draw, 300); }).observe($('#text'), { childList: true });
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__matter = { all, put, known, draw, SAME };
  draw();
}
