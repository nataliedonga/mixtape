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
import { paragraphs, asText, pieces, request, instructions, SCHEMA, apply, tally, cost } from '../claude-core.js';
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'mixtape-anthropic-key', AUTO = 'mixtape-claude-auto', MODEL = 'claude-opus-5-5';
let api, bar, chat, running = null, sdk = null;
const getKey = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
const autoOn = () => { try { return localStorage.getItem(AUTO) !== '0'; } catch (e) { return true; } };
const T = () => window.TranscriptCore;
const legalOf = r => !!(r && r.legal && r.legal.on);
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
    if (api.sensitive && api.sensitive(c.track.id)) { r.claude = { ...(r.claude || {}), skipped: 'sensitive' }; return; }
    // 2. Claude, a part at a time
    const cl = await client(), legal = legalOf(r), paras = paragraphs(r.words), parts = pieces(paras), cast = castOf(r);
    job.step = 'claude'; job.parts = parts.length; draw();
    let words = r.words, people = [], log = [], usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, summary = [];
    for (let k = 0; k < parts.length; k++) {
      if (job.stop || api.cur !== c) throw Object.assign(new Error('stopped'), { stopped: true });
      if (api.sensitive && api.sensitive(c.track.id)) throw new Error('the recording was marked sensitive while Claude was reading it, so it stopped');
      job.part = k + 1; draw();
      const ps = paragraphs(words), body = { model: MODEL, max_tokens: 64000, thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: { type: 'json_schema', schema: SCHEMA } },
        system: [{ type: 'text', text: instructions(legal), cache_control: { type: 'ephemeral' } }], messages: [{ role: 'user', content: request(ps, parts[k], { title: c.track.title, people, legal, cast }) }] };
      const msg = await ask(cl, body);
      if (msg.stop_reason === 'refusal') throw new Error('Claude declined to read this part');
      const text = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join(''); let ans;
      try { ans = JSON.parse(text); } catch (e) { throw new Error('Claude’s answer could not be read'); }
      for (const [kk, v] of Object.entries(msg.usage || {})) if (typeof v === 'number' && kk in usage) usage[kk] += v;
      const res = apply(words, ps, parts[k], ans); words = res.words; log.push(...res.log); if (ans.summary) summary.push(ans.summary);
      for (const p of ans.people || []) if (!people.some(x => x.id === p.id)) people.push(p);
      // the paragraph numbers move as splits and notations go in: the next part is counted afresh from the words
      const shift = paragraphs(words).length - ps.length; for (let j = k + 1; j < parts.length; j++) { parts[j] = [parts[j][0] + shift, parts[j][1] + shift]; }
    }
    api.remember(); r.words = words; r.speakers = true; r.auto = r.auto || { at: Date.now(), names: [] }; // the rule-based guesses are not run on top of Claude's
    r.claude = { at: Date.now(), model: MODEL, legal, people, log, count: tally(log), usage, cost: cost(usage), summary: summary.join(' '), why, chat: (r.claude && r.claude.chat) || [] };
    api.drawAll(); await api.save();
    const n = r.claude.count; api.toast(`Claude set the speakers${n.splits ? `, split ${n.splits} paragraph${n.splits === 1 ? '' : 's'}` : ''}${n.inserts ? `, and put in ${n.inserts} notation${n.inserts === 1 ? '' : 's'}` : ''}. Ctrl + Z undoes it all.`, 8000);
  } catch (e) {
    if (!e.stopped) { r.claude = { ...(r.claude || {}), error: errText(e), at: Date.now() }; try { await api.save(); } catch (x) {} }
  } finally { running = null; draw(); }
}
async function ask(cl, body) {
  try { return await cl.beta.messages.stream({ ...body, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage(); } // if Opus declines a part, Anthropic's fallback model answers it
  catch (e) { if (e && e.status === 400 && /fallback/i.test(String(e.message))) return cl.messages.stream(body).finalMessage(); throw e; }
}
function errText(e) {
  const s = e && e.status;
  if (s === 401) return 'the API key was not accepted. Check it and save it again';
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
.para.claudeins { background: color-mix(in srgb, #7c6cf2 18%, transparent); border-radius: 6px; }`;

function draw() {
  const c = api.cur, r = c && c.tr; if (!bar) return;
  const show = r && r.mode === 'heard' && r.done && r.words && r.words.length;
  bar.hidden = !show; if (!show) return;
  const cl = r.claude || {}, key = !!getKey() || !!window.__claudeFake;
  let html = '';
  if (running) {
    const j = running, p = j.step === 'sides' ? (j.progress || 0) : j.parts ? (j.part - 1) / j.parts : 0;
    html = `<div class="cb-t"><b class="cl">${j.step === 'sides' ? 'Finding the speakers from the sides of the recording…' : `Claude is reading the transcript${j.parts > 1 ? `: part ${j.part} of ${j.parts}` : '…'}`}</b><small>${j.step === 'sides' ? 'Only for calls with each person on their own side: exact, and nothing is sent.' : 'Only the words are sent to Anthropic, never the sound. You can keep working.'}</small></div><button data-c="stop">Stop</button><div class="prog"><i style="width:${Math.round(p * 100)}%"></i></div>`;
  } else if (api.sensitive && api.sensitive(c.track.id)) {
    html = `<div class="cb-t"><b class="cl">Claude</b><small>This recording is marked sensitive: nothing from it is sent to Claude.</small></div>`;
  } else if (!key) {
    html = `<div class="cb-t"><b class="cl">Let Claude set the speakers and notations</b><small>Paste your Anthropic API key (from console.anthropic.com → API keys). It is kept in this browser only, and only the transcript’s words are sent, never the sound.</small></div><input type="password" id="claudeKey" placeholder="sk-ant-…" autocomplete="off" aria-label="Anthropic API key"><button class="yes" data-c="savekey">Save</button>`;
  } else if (cl.error && !cl.log) {
    html = `<div class="cb-t"><b class="cl">Claude could not finish</b><small>${esc(cl.error)}. The transcript is as it was.</small></div><button data-c="run">Try again</button><button data-c="forget">Change key</button>`;
  } else if (cl.log) {
    const n = cl.count || tally(cl.log);
    html = `<div class="cb-t"><b class="cl">Claude set the speakers</b><small>${(cl.people || []).length} people · ${n.speakers} paragraph${n.speakers === 1 ? '' : 's'} given a speaker · ${n.splits} split · ${n.inserts} notation${n.inserts === 1 ? '' : 's'} put in${n.skipped ? ` · ${n.skipped} it suggested could not be placed` : ''} · ${money(cl.cost || 0)} · ${cl.legal ? 'TranscribeMe guidelines' : 'Rev style'}</small></div><button class="yes" data-c="chat">Ask Claude</button><button data-c="run" title="Read it again with the speakers as they are now">Run again</button>`;
  } else {
    html = `<div class="cb-t"><b class="cl">Claude</b><small>${autoOn() ? 'Waiting to read this transcript.' : 'Automatic reading is off.'}</small></div><button class="yes" data-c="run">Set speakers and notations</button>`;
  }
  if (!running && key) html += `<label style="font-size:13px;opacity:.8;display:flex;gap:6px;align-items:center"><input type="checkbox" id="claudeAuto"${autoOn() ? ' checked' : ''}> After every transcript</label>`;
  if (bar.dataset.k !== html) { bar.innerHTML = html; bar.dataset.k = html; }
  // highlight what Claude put in
  for (const p of document.querySelectorAll('#text .para')) { const w = r.words[+p.dataset.i0]; p.classList.toggle('claudeins', !!(w && w.lg && w.lg.by === 'claude')); }
}
async function onBar(e) {
  const b = e.target.closest('button'), c = api.cur, r = c && c.tr; if (!b || !r) return;
  const a = b.dataset.c;
  if (a === 'savekey') { const v = ($('#claudeKey').value || '').trim(); if (!/^sk-ant-/.test(v)) return api.toast('That does not look like an Anthropic API key (they start with sk-ant-).', 6000); try { localStorage.setItem(KEY, v); } catch (err) { return api.toast('The key could not be kept in this browser.', 6000); } $('#claudeKey').value = ''; api.toast('Key saved in this browser.', 3000); draw(); if (!r.claude || !r.claude.log) run('first key'); return; }
  if (a === 'forget') { try { localStorage.removeItem(KEY); } catch (err) {} r.claude = {}; return draw(); }
  if (a === 'stop') { if (running) running.stop = true; return; }
  if (a === 'run') { r.claude = { chat: (r.claude && r.claude.chat) || [] }; return run('asked'); }
  if (a === 'chat') return openChat();
}

/* ---- 3. the chat ---- */
function chatSystem(r, title) {
  const paras = paragraphs(r.words), cl = r.claude || {};
  return `You set the speakers and notations in this transcript earlier, and now you talk with the person who checks it. Answer plainly and briefly, with paragraph numbers and times, about what you changed, what you left alone, how sure you were, and why. You cannot change the transcript from this chat: if she wants something changed, say exactly what (paragraph, words, new speaker) so she can do it, or tell her to press "Run again" after she has fixed the parts she is sure of. Never invent words that are not in the transcript.

Guidelines followed: ${cl.legal ? "TranscribeMe's (legal transcript)" : "Rev's style guide"}.
Recording: ${title}
People you labelled: ${(cl.people || []).map(p => `${p.label} (${p.why || 'no reason given'})`).join('; ') || 'none'}
Your own summary: ${cl.summary || 'none'}
What you changed (log): ${JSON.stringify((cl.log || []).slice(0, 1500))}

The transcript as it is now:
${asText(paras)}`;
}
function openChat() {
  const r = api.cur && api.cur.tr; if (!r) return; chat.hidden = false; drawChat(); chat.querySelector('textarea').focus();
}
function drawChat(streaming = '') {
  const r = api.cur && api.cur.tr, cl = (r && r.claude) || {}, n = cl.count || tally(cl.log || []), msgs = chat.querySelector('.msgs');
  msgs.innerHTML = `<div class="facts">What Claude did: ${(cl.people || []).length} people labelled (${esc((cl.people || []).map(p => p.label).join(', '))}); ${n.speakers} paragraphs given a speaker; ${n.splits} paragraphs split; ${n.inserts} notations put in; ${n.skipped} suggestions it could not place. Cost so far ${money((cl.cost || 0) + (cl.chatCost || 0))}. No heard word was changed.</div>`
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
    const cl = await client(); let out = '';
    const st = cl.messages.stream({ model: MODEL, max_tokens: 16000, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' },
      system: [{ type: 'text', text: chatSystem(r, c.track.title), cache_control: { type: 'ephemeral' } }], messages: r.claude.chat.map(m => ({ role: m.role, content: m.text })) });
    st.on('text', d => { out += d; drawChat(out); });
    const msg = await st.finalMessage();
    if (!out) out = (msg.content || []).filter(b => b.type === 'text').map(b => b.text).join('') || (msg.stop_reason === 'refusal' ? 'Claude declined to answer that.' : '(no answer)');
    r.claude.chat.push({ role: 'assistant', text: out }); r.claude.chatCost = (r.claude.chatCost || 0) + cost(msg.usage);
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
/* the rule-based guesses (roles.js) wait for Claude when Claude will read this transcript */
export function claudePending(r) { return !!(r && !r.auto && r.mode === 'heard' && r.done && (running || ((getKey() || window.__claudeFake) && autoOn() && !(r.claude && (r.claude.log || r.claude.error || r.claude.skipped))) || !r.sidesDone)); }

export function initClaude(a) {
  api = a; const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
  bar = document.createElement('section'); bar.id = 'claudeBar'; bar.hidden = true; bar.setAttribute('aria-label', 'Claude'); $('#text').before(bar);
  bar.addEventListener('click', onBar);
  bar.addEventListener('change', e => { if (e.target.id === 'claudeAuto') { try { localStorage.setItem(AUTO, e.target.checked ? '1' : '0'); } catch (err) {} draw(); maybeRun(); } });
  bar.addEventListener('keydown', e => { if (e.target.id === 'claudeKey' && e.key === 'Enter') { e.preventDefault(); bar.querySelector('[data-c="savekey"]').click(); } });
  chat = document.createElement('aside'); chat.id = 'claudeChat'; chat.hidden = true; chat.setAttribute('aria-label', 'Ask Claude about this transcript');
  chat.innerHTML = `<header><b>Ask Claude about this transcript</b><button type="button" data-x aria-label="Close">Close</button></header><div class="msgs" aria-live="polite"></div><form><textarea placeholder="What did you change in the first ten minutes? Why is paragraph 42 the witness?" aria-label="Your question"></textarea><button class="yes" type="submit">Send</button></form>`;
  document.body.append(chat);
  chat.querySelector('[data-x]').addEventListener('click', () => { chat.hidden = true; });
  chat.querySelector('form').addEventListener('submit', e => { e.preventDefault(); const ta = chat.querySelector('textarea'), v = ta.value; ta.value = ''; send(v); });
  chat.querySelector('textarea').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chat.querySelector('form').requestSubmit(); } if (e.key === 'Escape') chat.hidden = true; });
  new MutationObserver(maybeRun).observe($('#text'), { childList: true });
  setInterval(maybeRun, 1500); // a transcript that finishes while the text is not redrawn
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__claude = { run, send, draw, sides, bySide, get running() { return running; } };
  maybeRun();
}
