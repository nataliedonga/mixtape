/* Mixtape transcripts: speakers and notations by Claude, and a chat about what it did.

   When a transcript is finished:
   1. A two-sided recording (a call with each person on their own side) gets its speakers from the sides: exact, free,
      and done here, in a few seconds. Mixtape's own speaker finder (which listened for voices) is no longer used.
   2. Claude (Opus 5.5, at Anthropic) reads the words and sets who said what, splits a paragraph where the speaker
      changes inside it, and puts in notations. It runs by itself after every transcript, unless the recording is
      marked sensitive or no API key has been given. Only the words are sent, never the sound. Every change is applied
      at once and listed; Ctrl + Z takes all of it back; each notation can be kept or undone in the bar above the text.
      Legal transcripts follow TranscribeMe's guidelines, all others Rev's (claude-core.js).
   3. "Ask Claude" opens a chat about the transcript: what it changed, what it did not, how much.

   The key is the user's own Anthropic API key, kept in this browser only (localStorage) and sent only to
   api.anthropic.com. The SDK is Anthropic's own (vendor/anthropic, Apache-2.0). */
import * as M from '../vendor/mediabunny/mediabunny.min.mjs';
import { paragraphs, asText, pieces, request, instructions, SCHEMA, apply, restyle, applyOps, EDIT_TOOL, itemReader, joinSameSpeaker, finish, dashes, tally, cost } from '../claude-core.js';
import { styleOf } from './matter.js';
import { guideFor } from '../style-guides.js';
import { readGuide, ACCEPT, countWords } from './guidefile.js';
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'mixtape-anthropic-key', AUTO = 'mixtape-claude-auto', MODEL = 'claude-opus-5-5';
let api, bar, chat, running = null, sdk = null;
const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
const autoOn = () => { try { return localStorage.getItem(AUTO) !== '0'; } catch (e) { return true; } };
const T = () => window.TranscriptCore;
/* which guide a transcript follows: her choice in the bar if she made one, else legal when the Legal switch is on */
const legalOf = r => (r && r.guideKind ? r.guideKind === 'legal' : !!(r && r.legal && r.legal.on));
/* her own style guides: loaded from a text file, kept in this browser only (never in Mixtape's code), used whole as the bible */
const GKEY = k => `mixtape-style-guide-${k}`;
const ownGuide = legal => { try { const g = JSON.parse(localStorage.getItem(GKEY(legal ? 'legal' : 'normal')) || 'null'); return g && typeof g.text === 'string' && g.text.trim() ? g : null; } catch (e) { return null; } };
const guideText = legal => { const g = ownGuide(legal); return g ? g.text : guideFor(legal); };
const guideName = legal => { const g = ownGuide(legal); return g ? g.name : legal ? 'Mixtape’s built-in legal guide' : 'Mixtape’s built-in guide'; };
const castOf = r => { try { const m = (JSON.parse(localStorage.getItem('mixtape-matters') || '{}') || {})[r.matter]; return m && Array.isArray(m.people) ? m.people.map(p => String(p && p.name || '').trim()).filter(Boolean) : []; } catch (e) { return []; } };
const money = d => (d < 0.01 ? 'under 1 cent' : `$${d.toFixed(2)}`);

async function client() {
  if (window.__claudeFake) return window.__claudeFake; // checks on this computer only: a stand-in that answers like the API
  if (!sdk) sdk = await import('../vendor/anthropic/anthropic-sdk.mjs');
  return new sdk.Anthropic({ apiKey: getKey(), dangerouslyAllowBrowser: true }); // her own key, in her own browser
}

/* ---- 1. speakers from the sides of a two-sided recording ---- */
async function sides(cur, tick) {
  const input = new M.Input({ source: new M.BlobSource(cur.blob), formats: M.ALL_FORMATS }), a = await input.getPrimaryAudioTrack();
  if (!a || a.numberOfChannels !== 2 || !(await a.canDecode())) return null;
  const dur = await a.computeDuration(), fr = 0.05, n = Math.ceil(dur / fr) + 1, L = new Float32Array(n), R = new Float32Array(n), C = new Uint16Array(n);
  const sink = new M.AudioSampleSink(a); let done = 0;
  for await (const s of sink.samples(0)) {
    const k = s.numberOfFrames, ch = s.numberOfChannels, sr = s.sampleRate, buf = new Float32Array(k * ch); s.copyTo(buf, { planeIndex: 0, format: 'f32' });
    for (let i = 0; i < k; i += 4) { const f = Math.floor((s.timestamp + i / sr) / fr); if (f < 0 || f >= n) continue; const l = buf[i * ch], r = buf[i * ch + 1]; L[f] += l * l; R[f] += r * r; C[f]++; }
    s.close(); done = s.timestamp; if (tick) tick(Math.min(1, done / dur));
  }
  let act = 0, one = 0, l = 0, r = 0;
  for (let f = 0; f < n; f++) { if (!C[f]) continue; L[f] /= C[f]; R[f] /= C[f]; const hi = Math.max(L[f], R[f]); if (hi < 1e-5) continue; act++; const dbd = 10 * Math.log10((Math.max(L[f], R[f]) + 1e-12) / (Math.min(L[f], R[f]) + 1e-12)); if (dbd > 10) { one++; if (L[f] > R[f]) l++; else r++; } }
  if (act < 40 || one / act < 0.7 || Math.min(l, r) < act * 0.05) return null; // the same sound on both sides, or one side nearly silent: not two people on two sides
  return t0 => (t1 => { let sl = 0, sr = 0; for (let f = Math.floor(t0 / fr); f <= Math.floor(t1 / fr) && f < n; f++) { sl += L[f]; sr += R[f]; } return sl === sr ? '' : sl > sr ? 'left' : 'right'; });
}
/* each word takes its side; a new paragraph where the side changes; "Speaker 1" / "Speaker 2" in the order they first speak */
function bySide(words, sideAt) {
  const names = {}; let k = 0, prev = '';
  return words.map((w, i) => {
    if (w.lg && w.lg.k === 'n') return w;
    const s = w.s != null ? sideAt(w.s)(w.e ?? w.s) || prev : prev; const name = s ? (names[s] ||= `Speaker ${++k}`) : '';
    const start = i === 0 || w.p || (s && s !== prev); prev = s || prev;
    const { sp, side, p, ...rest } = w; return start ? { ...rest, p: true, ...(name ? { sp: name, side: s } : {}) } : rest;
  });
}

/* ---- 2. Claude sets speakers and notations ---- */
async function run(why = 'auto') {
  const c = api.cur, r = c && c.tr; if (!r || running || api.job) return;
  if (api.sensitive && api.sensitive(c.track.id)) { r.claude = { ...(r.claude || {}), skipped: 'sensitive' }; return draw(); }
  const job = running = { stop: false, part: 0, parts: 0, step: 'sides' }; draw();
  try {
    // 1. the sides
    if (!r.sidesDone) {
      let at = null; try { at = await sides(c, p => { job.progress = p; draw(); }); } catch (e) { console.warn('sides:', e); }
      if (api.cur !== c) return;
      if (at) { api.remember(); r.words = bySide(r.words, at); r.speakers = true; r.bySides = true; api.drawAll(); }
      r.sidesDone = true; await api.save();
    }
    if (!getKey() && !window.__claudeFake) { draw(); return; }
    if (why === 'auto' && !autoOn()) { draw(); return; } // “After every transcript” is off: the sides are found, Claude waits to be asked
    if (api.sensitive && api.sensitive(c.track.id)) { r.claude = { ...(r.claude || {}), skipped: 'sensitive' }; return; }
    // 2. Claude, a part at a time, each decision shown and (punctuation) applied as it arrives
    const cl = await client(), legal = legalOf(r), cast = castOf(r), parts = pieces(paragraphs(r.words), 1500);
    job.step = 'claude'; job.parts = parts.length; job.feed = []; draw();
    api.remember(); // one Ctrl + Z for everything Claude does, even if it is stopped part-way
    let words = r.words, marks = 0, styledN = 0, cutN = 0, refusedN = 0, changes = [], keep = new Set(), kept = 0, people = [], log = [], usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, summary = [];
    const feed = t => { job.feed.push(t); if (job.feed.length > 80) job.feed.shift(); drawSoon(); };
    for (let k = 0; k < parts.length; k++) {
      if (job.stop || api.cur !== c) throw Object.assign(new Error('stopped'), { stopped: true });
      if (api.sensitive && api.sensitive(c.track.id)) throw new Error('the recording was marked sensitive while Claude was reading it, so it stopped');
      job.part = k + 1; draw();
      const ps = paragraphs(words), [a, b] = parts[k], label = id => (people.find(p => p.id === id) || {}).label || id;
      const body = { model: MODEL, max_tokens: 64000, thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
        system: [{ type: 'text', text: instructions(legal, (ownGuide(legal) || {}).text || ''), cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: request(ps, parts[k], { title: c.track.title, people, legal, cast }) }] };
      const rd = itemReader((key, x) => {
        if (key === 'people' && x.id && !people.some(p => p.id === x.id)) { people.push(x); feed(`Person: ${x.label}${x.why ? ` (${x.why})` : ''}`); }
        else if (key === 'turns' && x.para >= a && x.para < b) feed(`¶${x.para}${x.starts_with ? ` from “${x.starts_with}”` : ''} → ${label(x.speaker)}${x.why ? ` (${x.why})` : ''}`);
        else if (key === 'paras' && x.para >= a && x.para < b) { const pu = restyle(words, ps, [x]); words = pu.words; marks += pu.marked; styledN += pu.styled; cutN += pu.cut; refusedN += pu.refused; changes.push(...pu.changes); r.words = words; job.live = ps[x.para] && ps[x.para].i0; feed(`¶${x.para} styled: ${pu.marked} marks${pu.styled ? `, ${pu.styled} restyled (${pu.changes.filter(q => q.to).slice(0, 3).map(q => `${q.from} → ${q.to}`).join('; ')})` : ''}${pu.cut ? `, ${pu.cut} left out` : ''}${pu.refused ? `, ${pu.refused} refused` : ''}`); redrawSoon(); }
        else if (key === 'inserts' && x.text) feed(`Notation after ¶${x.para}: ${x.text}`);
      });
      const msg = await ask(cl, body, d => rd.push(d), job);
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined to read this part');
      const text = (msg.content || []).filter(bl => bl.type === 'text').map(bl => bl.text).join(''); let ans;
      try { ans = JSON.parse(text); } catch (e) { throw new Error('Claude’s answer could not be read'); }
      for (const [kk, v] of Object.entries(msg.usage || {})) if (typeof v === 'number' && kk in usage) usage[kk] += v;
      const pu = restyle(words, ps, (ans.paras || []).filter(x => x.para >= a && x.para < b)); words = pu.words; marks += pu.marked; styledN += pu.styled; cutN += pu.cut; changes.push(...pu.changes); // anything the live reading missed (it changes no word, so the numbers stay)
      const res = apply(words, ps, parts[k], ans); words = res.words; log.push(...res.log); if (ans.summary) summary.push(ans.summary);
      for (const i of res.keep) keep.add(i + kept); // breaks Claude chose to keep (counted afresh below, after earlier parts were joined)
      for (const p of ans.people || []) if (!people.some(x => x.id === p.id)) people.push(p);
      const t = tally(res.log); feed(`Part ${k + 1} of ${parts.length} done: ${t.speakers} speakers set, ${t.splits} split, ${t.inserts} notation${t.inserts === 1 ? '' : 's'}${t.skipped ? `, ${t.skipped} could not be placed` : ''}`);
      r.words = words; job.live = null; api.drawAll(); try { await api.save(); } catch (e) {} // each finished part is kept
      // the paragraph numbers move as splits and notations go in: the next part is counted afresh from the words
      const shift = paragraphs(words).length - ps.length; for (let jx = k + 1; jx < parts.length; jx++) { parts[jx] = [parts[jx][0] + shift, parts[jx][1] + shift]; }
    }
    // the guide's paragraph rule and the rules that need no judgement, made sure of by Mixtape itself
    const jn = joinSameSpeaker(words, keep); words = jn.words; const fin = finish(words); words = fin.words;
    r.words = words; r.speakers = true; r.punct = { at: Date.now(), by: 'claude', marked: marks };
    r.styleFor = 'guide'; // Claude styled it to the guide, word rules included: Mixtape's own style rules leave it alone
    r.auto = r.auto || { at: Date.now(), names: [] }; // the rule-based guesses are not run on top of Claude's
    r.claude = { at: Date.now(), model: MODEL, legal, people, log, guide: guideName(legal), changes: changes.slice(0, 400), count: { ...tally(log), marks, styled: styledN, cut: cutN, refused: refusedN, joined: jn.joined, ends: fin.ends, caps: fin.caps, dashes: dashes(words) }, usage, cost: cost(usage), summary: summary.join(' '), why, chat: (r.claude && r.claude.chat) || [] };
    job.feed = []; api.drawAll(); await api.save();
    const n = r.claude.count; api.toast(`Claude styled it to the guide, set the speakers${n.splits ? `, split ${n.splits} paragraph${n.splits === 1 ? '' : 's'}` : ''}${n.inserts ? `, and put in ${n.inserts} notation${n.inserts === 1 ? '' : 's'}` : ''}. Ctrl + Z undoes it all.`, 8000);
  } catch (e) {
    if (!e.stopped) { r.claude = { ...(r.claude || {}), error: errText(e), at: Date.now() }; try { await api.save(); } catch (x) {} }
  } finally { running = null; draw(); }
}
async function ask(cl, body, onText, job) {
  const go = st => { if (onText) st.on('text', onText); if (job) job.abort = () => { try { st.abort(); } catch (e) {} }; return st.finalMessage(); };
  try { return await go(cl.beta.messages.stream({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })); } // if Opus declines a part, Anthropic's fallback model answers it
  catch (e) { if (e && e.status === 400 && /fallback/i.test(String(e.message))) return go(cl.messages.stream(body)); if (job && job.stop) throw Object.assign(new Error('stopped'), { stopped: true }); throw e; }
}
let drawT = 0, redrawT = 0;
const drawSoon = () => { clearTimeout(drawT); drawT = setTimeout(draw, 120); };
const redrawSoon = () => { if (redrawT) return; redrawT = setTimeout(() => { redrawT = 0; api.drawAll(); draw(); }, 700); }; // the text is redrawn at most every 0.7 s while punctuation streams in
function errText(e) {
  const s = e && e.status;
  if (s === 401) return 'the API key was not accepted. Check it and save it again';
  if (s === 400 && /workspace/i.test(String(e && e.message))) return 'this API key was made for the whole account, not inside a workspace. In the Anthropic console open Settings → Workspaces, choose one (or make one called Mixtape), create a key there, then press Change key and paste it';
  if (s === 429) return 'Anthropic says too many requests just now. Try again in a minute';
  if (s === 402 || /credit|billing/i.test(String(e && e.message))) return 'the Anthropic account has no credit left';
  if (s >= 500) return 'Anthropic’s servers had a problem. Try again in a moment';
  if (e && /fetch|network|Failed to fetch/i.test(String(e.message))) return 'Anthropic could not be reached (no connection?)';
  return (e && e.message) || String(e);
}

/* ---- the bar above the transcript ---- */
const STYLE = `
#claudeBar { margin: 0 0 10px; padding: 10px 12px; border: 1px solid var(--faint, #8884); border-radius: 10px; font: 14px/1.45 var(--f-ui, system-ui, sans-serif); display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
#claudeBar[hidden] { display: none; }
#claudeBar .cb-t { flex: 1 1 260px; min-width: 0; } #claudeBar small { display: block; opacity: .75; }
#claudeBar b.cl { font-weight: 650; } #claudeBar b.cl::before { content: '✦ '; color: var(--accent, #3FB8C4); }
#claudeBar button, #claudeChat button { height: 30px; padding: 0 12px; border: 1px solid var(--faint, #888); border-radius: 7px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
#claudeBar button.yes, #claudeChat button.yes { background: var(--accent, #1f6f78); border-color: var(--accent, #1f6f78); color: var(--accent-ink, #fff); font-weight: 650; }
#claudeBar input[type=password] { height: 30px; min-width: 240px; flex: 1; padding: 0 10px; border-radius: 7px; border: 1px solid var(--faint, #888); background: transparent; color: inherit; font: inherit; }
#claudeBar .prog { flex-basis: 100%; height: 3px; border-radius: 2px; background: color-mix(in srgb, currentColor 12%, transparent); overflow: hidden; } #claudeBar .prog i { display: block; height: 100%; background: var(--accent, #3FB8C4); transition: width .3s; }
#claudeChat { position: fixed; right: 0; top: 0; bottom: 0; z-index: 70; width: min(420px, 100vw); display: flex; flex-direction: column; background: var(--bg, #15181b); color: var(--ink, inherit); border-left: 1px solid var(--faint, #8884); box-shadow: -12px 0 30px #0006; font: 14px/1.5 var(--f-ui, system-ui, sans-serif); }
#claudeChat[hidden] { display: none; }
#claudeChat header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid var(--faint, #8884); } #claudeChat header b { flex: 1; }
#claudeChat .msgs { flex: 1; overflow: auto; padding: 14px; display: grid; gap: 10px; align-content: start; }
#claudeChat .m { padding: 9px 12px; border-radius: 10px; white-space: pre-wrap; overflow-wrap: anywhere; max-width: 92%; }
#claudeChat .m.u { justify-self: end; background: color-mix(in srgb, var(--accent, #3FB8C4) 22%, transparent); }
#claudeChat .m.a { justify-self: start; background: color-mix(in srgb, currentColor 7%, transparent); }
#claudeChat .facts { font-size: 13px; opacity: .85; padding: 10px 12px; border-radius: 10px; border: 1px dashed var(--faint, #8886); }
#claudeChat form { display: flex; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--faint, #8884); }
#claudeChat textarea { flex: 1; min-height: 42px; max-height: 140px; resize: vertical; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--faint, #888); background: transparent; color: inherit; font: inherit; }
.para.claudeins { background: color-mix(in srgb, #7c6cf2 18%, transparent); border-radius: 6px; }
.para.claudelive { box-shadow: inset 3px 0 0 var(--accent, #3FB8C4); background: color-mix(in srgb, var(--accent, #3FB8C4) 10%, transparent); border-radius: 6px; transition: background .4s; }
#claudeBar .feed { flex-basis: 100%; margin: 4px 0 0; padding: 8px 10px 8px 28px; max-height: 190px; overflow: auto; border-radius: 8px; background: color-mix(in srgb, currentColor 5%, transparent); font: 12.5px/1.5 var(--f-mono, ui-monospace, monospace); }
#claudeBar .gline { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; font-size: 13px; opacity: .9; } #claudeBar .gline select { height: 28px; border-radius: 6px; border: 1px solid var(--faint, #888); background: transparent; color: inherit; font: inherit; } #claudeBar .gline button { height: 28px; } #claudeBar .gname { opacity: .8; }
.w.claudestyled { text-decoration: underline dotted color-mix(in srgb, #7c6cf2 80%, transparent); text-underline-offset: 3px; }
#guideSheet { width: min(660px, calc(100vw - 28px)); max-height: calc(100vh - 40px); padding: 0; border: 1px solid var(--line, #8884); border-radius: 16px; background: var(--sheet, Canvas); color: var(--ink, CanvasText); font: 14px/1.5 var(--f-ui, system-ui, sans-serif); box-shadow: 0 24px 70px #0007; overflow: auto; }
#guideSheet::backdrop { background: #0009; }
#guideSheet header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; padding: 14px 18px; background: var(--sheet, Canvas); border-bottom: 1px solid var(--line, #8884); } #guideSheet header b { flex: 1; font-size: 17px; font-weight: 650; }
#guideSheet .lead { margin: 14px 18px 4px; color: var(--muted, inherit); }
#guideSheet button { height: 32px; padding: 0 13px; border: 1px solid var(--faint, #888); border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; } #guideSheet button:disabled { opacity: .5; cursor: default; }
#guideSheet button.yes { background: var(--accent, #1f6f78); border-color: var(--accent, #1f6f78); color: var(--accent-ink, #fff); font-weight: 650; }
#guideSheet .gcard { margin: 12px 18px; padding: 14px 16px; border: 1.5px dashed var(--faint, #8886); border-radius: 12px; transition: border-color .15s, background .15s; }
#guideSheet .gcard.has { border-style: solid; border-color: var(--line, #8884); } #guideSheet .gcard.over { border-style: solid; border-color: var(--accent, #3FB8C4); background: color-mix(in srgb, var(--accent, #3FB8C4) 12%, transparent); }
#guideSheet .gh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; } #guideSheet .gh b { font-weight: 650; } #guideSheet .gh small { flex-basis: 100%; color: var(--muted, inherit); }
#guideSheet .gtag { font-size: 11.5px; padding: 1px 8px; border-radius: 99px; background: color-mix(in srgb, var(--accent, #3FB8C4) 22%, transparent); }
#guideSheet .gfile { display: flex; gap: 10px; align-items: center; margin: 12px 0 0; padding: 10px 12px; border-radius: 9px; background: color-mix(in srgb, currentColor 6%, transparent); } #guideSheet .gfile b { display: block; overflow-wrap: anywhere; } #guideSheet .gfile small { color: var(--muted, inherit); }
#guideSheet .gicon { flex: none; width: 26px; height: 26px; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, currentColor 10%, transparent); font-weight: 700; } #guideSheet .gcard.has .gicon { background: var(--accent, #1f6f78); color: var(--accent-ink, #fff); }
#guideSheet .gcard.busy .gicon { animation: gspin 1s linear infinite; border: 2px solid color-mix(in srgb, currentColor 20%, transparent); border-top-color: var(--accent, #3FB8C4); background: none; color: transparent; } @keyframes gspin { to { transform: rotate(360deg); } }
#guideSheet .gnote { margin: 10px 0 0; padding: 8px 12px; border-radius: 9px; } #guideSheet .gnote.ok { background: color-mix(in srgb, #2e9d5b 18%, transparent); } #guideSheet .gnote.bad { background: color-mix(in srgb, #d0453a 18%, transparent); }
#guideSheet .gacts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; } #guideSheet .gor { flex: 1; min-width: 150px; font-size: 13px; color: var(--muted, inherit); }
#guideSheet .gtext { margin: 12px 0 0; max-height: 260px; overflow: auto; padding: 12px; border-radius: 9px; background: var(--paper, #0002); white-space: pre-wrap; overflow-wrap: anywhere; font: 12.5px/1.55 var(--f-read, Georgia, serif); }
#guideSheet footer { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 18px 16px; } #guideSheet footer small { flex: 1 1 280px; color: var(--muted, inherit); } #guideSheet .gend { display: flex; gap: 8px; margin-left: auto; }
#claudeBar .gname b { font-weight: 600; }
#claudeBar .feed li { margin: 0; } #claudeBar .feed li:last-child { font-weight: 650; }`;

function draw() {
  const c = api.cur, r = c && c.tr; if (!bar) return;
  const show = r && r.mode === 'heard' && r.done && r.words && r.words.length;
  bar.hidden = !show; if (!show) return;
  const cl = r.claude || {}, key = !!getKey() || !!window.__claudeFake;
  let html = '';
  if (running) {
    const j = running, p = j.step === 'sides' ? (j.progress || 0) : j.parts ? (j.part - 1) / j.parts : 0;
    html = `<div class="cb-t"><b class="cl">${j.step === 'sides' ? 'Finding the speakers from the sides of the recording…' : `Claude is reading the transcript${j.parts > 1 ? `: part ${j.part} of ${j.parts}` : '…'}`}</b><small>${j.step === 'sides' ? 'Only for calls with each person on their own side: exact, and nothing is sent.' : 'Only the words are sent to Anthropic, never the sound. You can keep working.'}</small></div><button data-c="stop">Stop</button><div class="prog"><i style="width:${Math.round(p * 100)}%"></i></div>${j.feed && j.feed.length ? `<ol class="feed" aria-live="polite">${j.feed.slice(-40).map(t => `<li>${esc(t)}</li>`).join('')}</ol>` : ''}`;
  } else if (api.sensitive && api.sensitive(c.track.id)) {
    html = `<div class="cb-t"><b class="cl">Claude</b><small>This recording is marked sensitive: nothing from it is sent to Claude.</small></div>`;
  } else if (!key) {
    html = `<div class="cb-t"><b class="cl">Let Claude set the speakers and notations</b><small>Paste your Anthropic API key (from console.anthropic.com → API keys). It is kept in this browser only, and only the transcript’s words are sent, never the sound.</small></div><input type="password" id="claudeKey" placeholder="sk-ant-…" autocomplete="off" aria-label="Anthropic API key"><button class="yes" data-c="savekey">Save</button>`;
  } else if (cl.error && !cl.log) {
    html = `<div class="cb-t"><b class="cl">Claude could not finish</b><small>${esc(cl.error)}. The transcript is as it was.</small></div><button data-c="run">Try again</button><button data-c="forget">Change key</button>`;
  } else if (cl.log) {
    const n = cl.count || tally(cl.log);
    html = `<div class="cb-t"><b class="cl">Claude styled it to the guide and set the speakers</b><small>${(cl.people || []).length} people · ${n.speakers} paragraph${n.speakers === 1 ? '' : 's'} given a speaker · ${n.splits} split · ${n.inserts} notation${n.inserts === 1 ? '' : 's'} put in · ${(n.marks || 0).toLocaleString()} words punctuated or capitalised · ${n.styled ?? 0} restyled · ${n.cut ?? 0} left out (stutters, fillers) · ${n.dashes ?? 0} false start${n.dashes === 1 ? '' : 's'} marked · ${n.joined ?? 0} pause break${n.joined === 1 ? '' : 's'} joined${n.ends ? ` · ${n.ends} missing full stop${n.ends === 1 ? '' : 's'} added by Mixtape` : ''}${n.skipped ? ` · ${n.skipped} it suggested could not be placed` : ''} · ${money(cl.cost || 0)} · guide: ${esc(cl.guide || (cl.legal ? 'legal' : 'ordinary'))}</small></div><button class="yes" data-c="chat">Ask Claude</button><button data-c="run" title="Read it again with the speakers as they are now">Run again</button>`;
  } else {
    html = `<div class="cb-t"><b class="cl">Claude</b><small>${autoOn() ? 'Waiting to read this transcript.' : 'Automatic reading is off.'}</small></div><button class="yes" data-c="run">Set speakers and notations</button>`;
  }
  if (!running && key) { const lg = legalOf(r), own = ownGuide(lg);
    html += `<div class="gline"><label>This is <select id="claudeKind" title="Which style guide this transcript follows"><option value="legal"${lg ? ' selected' : ''}>a legal transcript</option><option value="normal"${lg ? '' : ' selected'}>an ordinary transcript</option></select></label><span class="gname">Style guide: <b>${esc(guideName(lg))}</b></span><button data-c="guides" title="Add the style guide you were given (PDF, Word or text), read it, or go back to the built-in one">${own ? 'Style guides…' : 'Add your style guide…'}</button><label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="claudeAuto"${autoOn() ? ' checked' : ''}> After every transcript</label></div>`; }
  if (bar.dataset.k !== html) { const f0 = bar.querySelector('.feed'), atEnd = !f0 || f0.scrollTop + f0.clientHeight >= f0.scrollHeight - 8; bar.innerHTML = html; bar.dataset.k = html; const f = bar.querySelector('.feed'); if (f && atEnd) f.scrollTop = f.scrollHeight; } // the list follows the newest line unless you scrolled up
  // highlight what Claude put in
  for (const p of document.querySelectorAll('#text .para')) { const w = r.words[+p.dataset.i0]; p.classList.toggle('claudeins', !!(w && w.lg && w.lg.by === 'claude')); p.classList.toggle('claudelive', !!(running && running.live != null && +p.dataset.i0 === running.live)); }
  for (const el of document.querySelectorAll('#text .w[data-i]')) { const w = r.words[+el.dataset.i], on = !!(w && w.o != null && w.o !== w.t); if (on !== el.classList.contains('claudestyled')) { el.classList.toggle('claudestyled', on); if (on) el.title = `Heard: ${w.o}`; else el.removeAttribute('title'); } }
}
async function onBar(e) {
  const b = e.target.closest('button'), c = api.cur, r = c && c.tr; if (!b || !r) return;
  const a = b.dataset.c;
  if (a === 'savekey') { const v = ($('#claudeKey').value || '').trim(); if (!/^sk-ant-/.test(v)) return api.toast('That does not look like an Anthropic API key (they start with sk-ant-).', 6000); try { localStorage.setItem(KEY, v); } catch (err) { return api.toast('The key could not be kept in this browser.', 6000); } $('#claudeKey').value = ''; api.toast('Key saved in this browser.', 3000); draw(); if (!r.claude || !r.claude.log) run('first key'); return; }
  if (a === 'forget') { try { localStorage.removeItem(KEY); } catch (err) {} r.claude = {}; return draw(); }
  if (a === 'stop') { if (running) { running.stop = true; if (running.abort) running.abort(); } return; }
  if (a === 'run') { r.claude = { chat: (r.claude && r.claude.chat) || [] }; return run('asked'); }
  if (a === 'chat') return openChat();
  if (a === 'guides') return openGuides();
}

/* ---- 3. the chat ---- */
function chatSystem(r, title) {
  const paras = paragraphs(r.words), cl = r.claude || {}, legal = cl.legal ?? legalOf(r);
  return `You work with the person who checks this transcript. You styled it earlier (speakers, paragraphs, punctuation, the guide's word rules); now she talks to you about it.

When she asks for a change, make it with the edit_transcript tool: do not just describe it or tell her to do it herself. Her instruction wins: if it differs from the style guide, do what she asks for that change (and say in one line that it departs from the guide, quoting the rule, so she knows). If an instruction is general ("make every interruption end with a double dash", "the judge is THE COURT everywhere"), carry it out across the whole transcript, in as many edit_transcript calls as it takes. Only heard words can be kept or restyled: you cannot add words that were not said, and you cannot hear the audio. After changing things, say briefly what you changed, with paragraph numbers. When she only asks a question, answer it plainly and briefly, with paragraph numbers and times.

The style guide is the bible for this transcript:
${guideText(!!legal)}

Recording: ${title}
People labelled: ${(cl.people || []).map(p => `${p.label} (${p.why || 'no reason given'})`).join('; ') || 'none'}
Your summary from the styling run: ${cl.summary || 'none'}
Words restyled then (heard → shown; "" means left out): ${JSON.stringify((cl.changes || []).slice(0, 200))}
Speaker and paragraph changes then (log): ${JSON.stringify((cl.log || []).slice(0, 600))}

The transcript as it is now:
${asText(paras)}`;
}
function openChat() {
  const r = api.cur && api.cur.tr; if (!r) return; chat.hidden = false; drawChat(); chat.querySelector('textarea').focus();
}
function drawChat(streaming = '') {
  const r = api.cur && api.cur.tr, cl = (r && r.claude) || {}, n = cl.count || tally(cl.log || []), msgs = chat.querySelector('.msgs');
  msgs.innerHTML = `<div class="facts">What Claude did: ${(cl.people || []).length} people labelled (${esc((cl.people || []).map(p => p.label).join(', '))}); ${n.speakers} paragraphs given a speaker; ${n.splits} paragraphs split; ${n.inserts} notations put in; ${(n.marks || 0)} words given punctuation or capitals; ${n.styled ?? 0} words restyled and ${n.cut ?? 0} left out (what was heard is kept underneath: restyled words are underlined, hover to see); ${n.skipped} suggestions it could not place. Cost so far ${money((cl.cost || 0) + (cl.chatCost || 0))}. You can ask for changes here: “make ¶12 the witness”, “write out the numbers in ¶30”.</div>`
    + (cl.chat || []).map(m => `<div class="m ${m.role === 'user' ? 'u' : 'a'}">${esc(m.text)}</div>`).join('') + (streaming ? `<div class="m a">${esc(streaming)}</div>` : '');
  msgs.scrollTop = msgs.scrollHeight;
}
async function send(text) {
  const c = api.cur, r = c && c.tr; if (!r || !text.trim()) return;
  if (api.sensitive && api.sensitive(c.track.id)) return api.toast('This recording is marked sensitive: nothing from it is sent to Claude.', 6000);
  if (!getKey() && !window.__claudeFake) return api.toast('Save your Anthropic API key first (in the bar above the transcript).', 6000);
  r.claude = r.claude || {}; r.claude.chat = r.claude.chat || []; r.claude.chat.push({ role: 'user', text }); drawChat('…');
  const form = chat.querySelector('form'); form.querySelector('button').disabled = true;
  try {
    const cl = await client(); let out = '', remembered = false, spent = 0;
    const msgs = r.claude.chat.map(m => ({ role: m.role, content: m.text }));
    for (let round = 0; round < 8; round++) { // she asks; Claude may change the transcript (a tool call), is told what happened, and goes on
      const st = cl.messages.stream({ model: MODEL, max_tokens: 32000, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, tools: [EDIT_TOOL],
        system: [{ type: 'text', text: chatSystem(r, c.track.title), cache_control: { type: 'ephemeral' } }], messages: msgs });
      st.on('text', d => { out += d; drawChat(out); });
      const msg = await st.finalMessage(); spent += cost(msg.usage);
      const uses = (msg.content || []).filter(b => b.type === 'tool_use');
      if (msg.stop_reason !== 'tool_use' || !uses.length) { if (!out) out = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || (msg.stop_reason === 'refusal' ? 'Claude declined to answer that.' : '(no answer)'); break; }
      const results = [];
      for (const u of uses) {
        let res; try { if (!remembered) { api.remember(); remembered = true; } res = applyOps(r.words, (u.input && u.input.ops) || []); r.words = finish(res.words).words; r.styleFor = r.styleFor || 'guide'; } catch (e) { res = { done: [], failed: [String(e.message || e)] }; }
        out += `${out && !out.endsWith('\n') ? '\n' : ''}${res.done.map(t => `✓ ${t}`).concat(res.failed.map(t => `✗ ${t}`)).join('\n')}\n`; drawChat(out);
        results.push({ type: 'tool_result', tool_use_id: u.id, content: `Done:\n${res.done.join('\n') || '(nothing)'}\nCould not do:\n${res.failed.join('\n') || '(nothing)'}\nParagraph numbers may have moved. The transcript now:\n${asText(paragraphs(r.words))}`, ...(res.failed.length && !res.done.length ? { is_error: true } : {}) });
      }
      api.drawAll(); draw();
      msgs.push({ role: 'assistant', content: msg.content }, { role: 'user', content: results });
    }
    r.claude.chat.push({ role: 'assistant', text: out.trim() }); r.claude.chatCost = (r.claude.chatCost || 0) + spent;
  } catch (e) { r.claude.chat.push({ role: 'assistant', text: `(Could not answer: ${errText(e)}.)` }); }
  finally { form.querySelector('button').disabled = false; drawChat(); try { await api.save(); } catch (e) {} }
}

/* runs by itself when a transcript is finished, once */
function maybeRun() {
  const c = api.cur, r = c && c.tr; draw();
  if (!r || running || api.job || r.mode !== 'heard' || !r.done || !r.words.length) return;
  if (r.claude && (r.claude.log || r.claude.error || r.claude.skipped)) return;
  if (r.auto) return; // a transcript finished before this, or already read by the rules: Claude reads it only when asked (the button)
  if (!r.sidesDone || (autoOn() && (getKey() || window.__claudeFake))) run('auto');
}
/* ---------- the style guides sheet: add the guide you were given, as the file it came in ---------- */
let sheet = null; const gs = { busy: {}, note: {}, view: null, fresh: null, pick: 'legal' };
const KINDS = [['legal', 'Legal transcripts', 'Court hearings, depositions, anything with the Legal switch on'], ['normal', 'All other transcripts', 'Interviews, meetings, calls, podcasts']];
const dayOf = at => { try { return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return ''; } };
function drawGuides() {
  if (!sheet) return; const c = api.cur, r = c && c.tr, mine = r ? (legalOf(r) ? 'legal' : 'normal') : null;
  const canRun = !!(r && r.done && (getKey() || window.__claudeFake) && !running && !(api.sensitive && api.sensitive(c.track.id)));
  const cards = KINDS.map(([k, title, sub]) => { const lg = k === 'legal', own = ownGuide(lg), busy = gs.busy[k], note = gs.note[k], view = gs.view === k, words = own ? (own.words || countWords(own.text)) : 0;
    return `<section class="gcard${own ? ' has' : ''}${busy ? ' busy' : ''}" data-kind="${k}"><div class="gh"><b>${title}</b>${mine === k ? '<span class="gtag">this transcript</span>' : ''}<small>${sub}</small></div>
      <div class="gfile"><span class="gicon" aria-hidden="true">${own ? '✓' : '·'}</span><div><b>${busy ? esc(busy) : own ? esc(own.name) : lg ? 'Mixtape’s built-in legal guide' : 'Mixtape’s built-in guide'}</b><small>${busy ? 'Reading it on this computer…' : own ? `${own.pages ? `${own.pages} page${own.pages === 1 ? '' : 's'} · ` : ''}${words.toLocaleString()} words${own.at ? ` · added ${dayOf(own.at)}` : ''} · Claude follows all of it` : 'In use until you add your own'}</small></div></div>
      ${note ? `<p class="gnote ${note.ok ? 'ok' : 'bad'}" role="status">${esc(note.text)}</p>` : ''}
      <div class="gacts"><button class="${own ? '' : 'yes'}" data-g="pick"${busy ? ' disabled' : ''}>${own ? 'Replace…' : 'Add your guide…'}</button><span class="gor">or drop the file here · PDF, Word or text</span><button data-g="view" aria-expanded="${view}">${view ? 'Hide' : 'Read it'}</button>${own ? '<button data-g="remove">Remove</button>' : ''}</div>
      ${view ? `<pre class="gtext" tabindex="0">${esc(guideText(lg))}</pre>` : ''}</section>`; }).join('');
  const f = gs.fresh, other = f && mine && f !== mine;
  sheet.innerHTML = `<header><b>Style guides</b><button type="button" data-g="close" aria-label="Close">Close</button></header>
    <p class="lead">Add the style guide you were given, just as it is. Claude then follows it for every transcript of that kind: speakers, paragraphs, punctuation and the way words are written.</p>
    ${cards}
    <footer><small>Your guide stays in this browser. It goes to Claude together with a transcript, so Claude can follow it; nothing is sent for recordings marked sensitive.</small><span class="gend">${f && canRun ? `<button class="yes" data-g="restyle">${other ? 'Use it for this transcript and restyle' : 'Restyle this transcript now'}</button>` : ''}<button data-g="close">Done</button></span></footer>
    <input type="file" id="guideFile" accept="${ACCEPT}" hidden>`;
}
function openGuides() {
  if (!sheet) { sheet = document.createElement('dialog'); sheet.id = 'guideSheet'; sheet.setAttribute('aria-label', 'Style guides'); document.body.append(sheet);
    sheet.addEventListener('click', onGuides);
    sheet.addEventListener('change', e => { if (e.target.id === 'guideFile' && e.target.files[0]) { const f = e.target.files[0]; e.target.value = ''; addGuide(gs.pick, f); } });
    sheet.addEventListener('close', () => { gs.note = {}; gs.view = null; gs.fresh = null; draw(); });
    // a file dropped on a card becomes that kind's guide; dropped anywhere else in the sheet it does nothing (and never opens in the tab)
    const cardAt = e => e.target.closest && e.target.closest('.gcard');
    sheet.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); const cd = cardAt(e); for (const x of sheet.querySelectorAll('.gcard')) x.classList.toggle('over', x === cd); e.dataTransfer.dropEffect = cd ? 'copy' : 'none'; });
    sheet.addEventListener('dragleave', e => { if (!sheet.contains(e.relatedTarget)) for (const x of sheet.querySelectorAll('.gcard')) x.classList.remove('over'); });
    sheet.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); const cd = cardAt(e), f = e.dataTransfer.files && e.dataTransfer.files[0]; for (const x of sheet.querySelectorAll('.gcard')) x.classList.remove('over'); if (cd && f) addGuide(cd.dataset.kind, f); });
  }
  gs.note = {}; gs.view = null; gs.fresh = null; drawGuides(); if (!sheet.open) sheet.showModal();
}
async function addGuide(kind, file) {
  if (gs.busy[kind]) return; const lg = kind === 'legal';
  gs.busy[kind] = file.name; delete gs.note[kind]; drawGuides();
  try {
    const g = await readGuide(file);
    try { localStorage.setItem(GKEY(kind), JSON.stringify({ name: g.name, text: g.text, pages: g.pages, words: g.words, at: Date.now() })); }
    catch (e) { throw Object.assign(new Error('The guide was read, but this browser has no room left to keep it. Free some space in Mixtape and add it again.'), { friendly: true }); }
    gs.fresh = kind; if (gs.view === kind) gs.view = null;
    gs.note[kind] = { ok: true, text: `Added. Claude will follow it for every ${lg ? 'legal' : 'other'} transcript from now on.` };
  } catch (e) { gs.note[kind] = { ok: false, text: e && e.friendly ? e.message : 'That file could not be read. Try the guide as a PDF, a Word document (.docx) or a text file.' }; if (!(e && e.friendly)) console.warn('style guide', e); }
  delete gs.busy[kind]; drawGuides(); draw();
}
async function onGuides(e) {
  const b = e.target.closest('button'); if (!b) return; const a = b.dataset.g, cd = b.closest('.gcard'), kind = cd && cd.dataset.kind;
  if (a === 'close') return sheet.close();
  if (a === 'pick') { gs.pick = kind; return sheet.querySelector('#guideFile').click(); }
  if (a === 'view') { gs.view = gs.view === kind ? null : kind; return drawGuides(); }
  if (a === 'remove') { try { localStorage.removeItem(GKEY(kind)); } catch (err) {} gs.fresh = kind; if (gs.view === kind) gs.view = null; gs.note[kind] = { ok: true, text: 'Removed from this browser. The built-in guide is in use again.' }; drawGuides(); return draw(); }
  if (a === 'restyle') { const c = api.cur, r = c && c.tr; if (!r) return; if (gs.fresh && gs.fresh !== (legalOf(r) ? 'legal' : 'normal')) { r.guideKind = gs.fresh; try { await api.save(); } catch (err) {} } sheet.close(); r.claude = { chat: (r.claude && r.claude.chat) || [] }; return run('asked'); }
}
/* the rule-based guesses (roles.js) wait for Claude when Claude will read this transcript */
export function claudePending(r) { return !!(r && !r.auto && r.mode === 'heard' && r.done && (running || ((getKey() || window.__claudeFake) && autoOn() && !(r.claude && (r.claude.log || r.claude.error || r.claude.skipped))) || !r.sidesDone)); }

export function initClaude(a) {
  api = a; const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
  bar = document.createElement('section'); bar.id = 'claudeBar'; bar.hidden = true; bar.setAttribute('aria-label', 'Claude'); $('#text').before(bar);
  bar.addEventListener('click', onBar);
  bar.addEventListener('change', async e => {
    const r = api.cur && api.cur.tr;
    if (e.target.id === 'claudeKind' && r) { r.guideKind = e.target.value; try { await api.save(); } catch (err) {} draw(); api.toast(`This transcript follows the ${r.guideKind === 'legal' ? 'legal' : 'ordinary'} guide (${guideName(r.guideKind === 'legal')}). Press Run again to restyle it.`, 6000); return; }
    if (e.target.id === 'claudeAuto') { try { localStorage.setItem(AUTO, e.target.checked ? '1' : '0'); } catch (err) {} draw(); maybeRun(); }
  });
  bar.addEventListener('keydown', e => { if (e.target.id === 'claudeKey' && e.key === 'Enter') { e.preventDefault(); bar.querySelector('[data-c="savekey"]').click(); } });
  chat = document.createElement('aside'); chat.id = 'claudeChat'; chat.hidden = true; chat.setAttribute('aria-label', 'Ask Claude about this transcript');
  chat.innerHTML = `<header><b>Ask Claude about this transcript</b><button type="button" data-x aria-label="Close">Close</button></header><div class="msgs" aria-live="polite"></div><form><textarea placeholder="What did you change in the first ten minutes? Why is paragraph 42 the witness?" aria-label="Your question"></textarea><button class="yes" type="submit">Send</button></form>`;
  document.body.append(chat);
  chat.querySelector('[data-x]').addEventListener('click', () => { chat.hidden = true; });
  chat.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const ta = chat.querySelector('textarea'), v = ta.value; ta.value = ''; send(v); });
  chat.querySelector('textarea').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chat.querySelector('form').requestSubmit(); } if (e.key === 'Escape') chat.hidden = true; });
  new MutationObserver(maybeRun).observe($('#text'), { childList: true });
  setInterval(maybeRun, 1500); // a transcript that finishes while the text is not redrawn
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__claude = { run, send, draw, sides, bySide, openGuides, addGuide, get running() { return running; } };
  maybeRun();
}
