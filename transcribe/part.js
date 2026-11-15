/* Transcribing only the part of a recording that a website has, and a clock that counts the way the website does.

   A long recording is often worked on in parts (a 3½-hour hearing whose transcript is split in three on the site you
   transcribe on). Before transcribing you can say that this is to follow along with a website: where its part starts
   in your recording, where it ends (or how long it is there), and any stretches the website leaves out that your
   recording still has. Only what the website has is written down. The transcript remembers its part.

   "Part's time" (in the player bar) then makes the clock, the slider and the times beside the paragraphs count the
   way the website counts: 0:00 at the start of the part, with the left-out stretches not counted. Untick it to see
   the recording's own time again.

   With Backup Track (the browser extension that plays your recording in step with the site) installed, none of this
   has to be typed: it already knows the start, the website's length and the stretches it skips, and they are taken
   from it. Without the extension this page cannot see the website at all, so the times are typed or picked by ear. */
import { render as renderTags } from '../tags-core.js';
import { styleOf } from './matter.js';
const $ = s => document.querySelector(s), KEY = 'mixtape-part-clock';
let api, sel = { id: null, on: false, skips: [], touched: false }, zero = true, inSheet = false; // inSheet: the form is open for a transcript that already exists
try { zero = localStorage.getItem(KEY) !== '0'; } catch (e) {}

export const hms = t => { t = Math.max(0, t || 0); let whole = Math.floor(t), frac = Math.round((t - whole) * 10); if (frac === 10) { whole++; frac = 0; } const p = n => String(n).padStart(2, '0'); return p(Math.floor(whole / 3600)) + ':' + p(Math.floor(whole / 60) % 60) + ':' + p(whole % 60) + (frac ? '.' + frac : ''); };
// "00:20:00", "20:00", "1:05:30", "75", "20m", "1h 5m": seconds, or null if it is not a time
export const parseTime = v => { v = String(v).trim().toLowerCase().replace(',', '.'); if (!v) return null; let s = null, m;
  if (/^\d+(\.\d+)?$/.test(v)) s = +v;
  else if ((m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(\.\d+)?$/.exec(v))) s = m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +(m[4] || 0) : +m[1] * 60 + +m[2] + +(m[4] || 0);
  else if ((m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/.exec(v)) && (m[1] || m[2] || m[3])) s = +(m[1] || 0) * 3600 + +(m[2] || 0) * 60 + +(m[3] || 0);
  return s == null || !isFinite(s) ? null : s; };
const r2 = x => Math.round(x * 100) / 100;

/* ---- the two clocks: the recording's own time, and the website's ---- */
// p = { a, b, skips: [{ a, b }] }, all in the recording's time; skips are sorted and do not overlap.
// p.off: where on the website the part begins, when the recording has only a later part of what the website plays (else 0).
// p.whole: the whole recording was written down and only this part is shown, so the next part needs no new transcribing.
const skipsOf = p => p.skips || [];
export const siteAt = (p, t) => { let s = (p.off || 0) + t - p.a; for (const k of skipsOf(p)) { if (t >= k.b) s -= k.b - k.a; else if (t > k.a) s -= t - k.a; } return s; }; // the website's time when the recording is at t
export const recAt = (p, s) => { let t = p.a + s - (p.off || 0); for (const k of skipsOf(p)) if (t >= k.a) t += k.b - k.a; return t; };                                         // and the other way round
const cleanSkips = (list, a, b) => { // inside the part, in order, joined where they touch
  const out = []; for (const k of [...list].filter(k => k && isFinite(k.a) && isFinite(k.b)).map(k => ({ a: r2(Math.max(a, k.a)), b: r2(Math.min(b, k.b)) })).filter(k => k.b - k.a >= 0.2).sort((x, y) => x.a - y.a)) { const last = out[out.length - 1]; if (last && k.a <= last.b) last.b = Math.max(last.b, k.b); else out.push(k); } return out; };
const part = () => { const c = api && api.cur; return c && c.tr && c.tr.part && c.tr.part.b > c.tr.part.a ? c.tr.part : null; };
const counting = () => zero && !!part();

/* ---- what the page asks ---- */
export function partClock(cur, t, d) { const p = counting() ? part() : null; if (!p) return { now: t, total: d, frac: d ? t / d : 0 }; const len = siteAt(p, p.b), s = Math.max(0, Math.min(len, siteAt(p, t))); return { now: s, total: len, frac: len ? s / len : 0 }; }
export function partSeek(cur, f, d) { const p = counting() ? part() : null; return p ? Math.max(p.a, recAt(p, f * siteAt(p, p.b))) : f * d; }
export function partShow(t) { const p = counting() ? part() : null; return p ? Math.max(0, siteAt(p, t)) : t; }
// the text files saved from a part count the same way as the clock does (the .json keeps the recording's own times, so it still opens with its recording)
/* what is saved: the part only (if one is shown), and the tags in the wording of the matter's style (tags-core.js).
   opts: { silence, unsure } from "Choose what goes in the file". The transcript itself is not touched. */
export function partExport(r, opts = {}) { const x = partOnly(r); return { ...x, words: renderTags(x.words, styleOf(r), opts) }; }
function partOnly(r) {
  const p = part(); if (!p) return r; const z = counting(); // only the part is saved; its times count like the clock does
  return { ...r, words: r.words.filter(w => w.s == null || !partHides(w.s)).map(w => !z || w.s == null ? w : { ...w, s: Math.max(0, siteAt(p, w.s)), e: w.e == null ? w.e : Math.max(0, siteAt(p, w.e)) }) };
}
// is this moment outside the part being shown (before it, after it, or in a stretch the website leaves out)?
export function partHides(t) { const p = part(); return !!p && (t < p.a - 0.01 || t >= p.b || skipsOf(p).some(k => t >= k.a && t < k.b)); }
// where this recording should be when the website's player is at t: by the part being shown, or the start being chosen in the form, or simply t
export function partRecForSite(t) { const before = (p, r) => (r < p.a - 0.01 ? -1 : r); /* the website is before the place the recording begins: nothing to play yet */
  const p = part(); if (p) return before(p, recAt(p, t)); const c = api && api.cur; if (c && sel.on && sel.id === c.track.id) { const a = parseTime($('#partFrom').value); if (a != null) { const q = { a, off: offNow(), skips: cleanSkips(sel.skips, a, Infinity) }; return before(q, recAt(q, t)); } } return t; }
const offNow = () => { const e = $('#partOff'), v = e ? parseTime(e.value) : null; return v != null && v > 0 ? r2(v) : 0; };
// once the part is written down: words inside a stretch the website leaves out are taken away, and what follows starts a new paragraph
export function partTrim(tr) {
  if (tr && tr.part && tr.part.whole) return 0; // the whole recording is kept; what the website leaves out is only hidden
  const ks = tr && tr.part ? skipsOf(tr.part) : []; if (!ks.length || !tr.words.length) return 0;
  const inSkip = t => ks.some(k => t >= k.a && t < k.b), n0 = tr.words.length; let gap = false;
  tr.words = tr.words.filter(w => { if (w.s != null && inSkip(w.s)) { gap = true; return false; } if (gap) { w.p = true; gap = false; } return true; });
  if (tr.words[0]) tr.words[0].p = true; return n0 - tr.words.length;
}
// the part chosen for a new transcript: { a, b, skips } in seconds; null for the whole recording; false if what was typed cannot be used (said in a toast)
export function partChosen(cur) {
  if (!cur || sel.id !== cur.track.id || !sel.on) return null;
  const d = cur.media.duration || cur.track.duration || 0, a = parseTime($('#partFrom').value), bRaw = $('#partTo').value.trim(), b = bRaw ? parseTime(bRaw) : d;
  if (a == null || b == null) { api.toast('Type the part’s times as hours:minutes:seconds, like 01:39:00.', 6000); return false; }
  if (d && a >= d) { api.toast(`This recording is ${hms(d)} long, so the part cannot start at ${hms(a)}.`, 6000); return false; }
  const end = d ? Math.min(b, d) : b; if (end - a < 1) { api.toast('The part must end after it starts.', 5000); return false; }
  const skips = cleanSkips(sel.skips, a, end);
  const off = offNow(), all = !inSheet && $('#partAllBox') && $('#partAllBox').checked;
  return { a: r2(a), b: r2(end), ...(skips.length ? { skips } : {}), ...(off ? { off } : {}), ...(all ? { whole: true } : {}) };
}

/* ---- choosing the part, in the "Write down what is said" card ---- */
const NOBT = 'Backup Track cannot be reached from this Mixtape window, so nothing is shared with it and the length has to be typed. It only works when Mixtape is open in the same Chrome (the same profile) where Backup Track is installed. If this is the installed Mixtape app, or another browser, open Mixtape in a tab next to the website instead.';
const HINT = 'With Backup Track following the website, the length appears here by itself. Without it, type the length the website shows (for example 00:32:46).';
function build() {
  const go = $('#goHeard'); if (!go || $('#partBox')) return;
  const f = document.createElement('fieldset'); f.id = 'partBox'; f.className = 'engine partbox';
  f.innerHTML = `<legend>Is this to follow along with a website?</legend>
    <label class="eng"><input type="radio" name="partWhich" id="partAll" value="all" checked><span><b>No: write down the whole recording</b></span></label>
    <label class="eng"><input type="radio" name="partWhich" id="partSome" value="part"><span><b>Yes: the website has only a part of it</b><small>Find where that part starts in your recording. Only that part is written down, unless you tick “Write down the whole recording now” further down.</small></span></label>
    <div id="partRow" hidden>
      <p class="partnote" id="partBTNote" hidden></p>
      <p class="partstep"><b>1.</b> Play your recording to the first words of the part.</p>
      <div class="partplay" role="group" aria-label="Play the recording to find the place">
        <button type="button" class="btn sm" data-pskip="-10" title="Back 10 seconds">−10 s</button><button type="button" class="btn sm" data-pskip="-5" title="Back 5 seconds">−5 s</button>
        <button type="button" class="btn sm primary" id="partPlay" title="Play or pause the recording, to find a place in it">▶ Play</button>
        <button type="button" class="btn sm" data-pskip="5" title="Forward 5 seconds">+5 s</button><button type="button" class="btn sm" data-pskip="10" title="Forward 10 seconds">+10 s</button>
        <span class="partnow" id="partNow" aria-live="off">00:00:00</span>
      </div>
      <div class="partrow"><button type="button" class="btn sm primary" id="partFromNow" title="The place the player is at becomes the start of the part">This part starts here</button><label for="partFrom">or type it</label><input id="partFrom" type="text" inputmode="numeric" value="00:00:00" placeholder="hh:mm:ss" autocomplete="off" aria-label="The part starts at (hours:minutes:seconds)"></div>
      <details class="partmore" id="partOffBox"><summary>My recording starts in the middle of the website’s</summary>
        <p class="parthint">If your recording has only a later part of what the website plays, say where on the website yours begins. The length in step 3 is then the website’s whole length, as its player shows it.</p>
        <div class="partrow"><label for="partOff">On the website, it starts at</label><input id="partOff" type="text" inputmode="numeric" placeholder="00:00:00" autocomplete="off" aria-label="Where on the website my recording starts (hours:minutes:seconds)"></div>
      </details>
      <div id="partAfter" hidden>
        <p class="partstep"><b>2.</b> How should the clock count?</p>
        <div class="partseg" role="group" aria-label="How the clock counts">
          <button type="button" data-pzero="0" title="The clock and the times show the time in your own recording">My file’s time</button>
          <button type="button" data-pzero="1" title="The start of the part counts as 0:00, so the clock reads the same as the website’s">This part’s time, like the site</button>
        </div>
        <p class="partstep"><b>3.</b> How long is the part on the website?</p>
        <div class="partrow"><input id="partLen" type="text" inputmode="numeric" placeholder="hh:mm:ss" autocomplete="off" aria-label="How long the part is on the website (hours:minutes:seconds)"><span class="parthint" id="partLenHint">${HINT}</span></div>
        <details class="partmore"><summary>Or say where it ends in your recording</summary>
          <div class="partrow"><label for="partTo">Ends at</label><input id="partTo" type="text" inputmode="numeric" placeholder="the end" autocomplete="off" aria-label="The part ends at (hours:minutes:seconds); empty means the end of the recording"><button type="button" class="btn sm" id="partToNow" title="The place the player is at becomes the end of the part">It ends here</button></div>
        </details>
        <details class="partmore" id="partSkipBox"><summary>The website leaves stretches out</summary>
          <p class="parthint">Stretches your recording still has but the website skips. They are not written down.</p>
          <ul class="partskips" id="partSkips" aria-label="Stretches the website leaves out"></ul>
          <div class="partrow"><label for="skipFrom">From</label><input id="skipFrom" type="text" inputmode="numeric" placeholder="hh:mm:ss" autocomplete="off" aria-label="The left-out stretch starts at"><button type="button" class="btn sm" id="skipFromNow" title="The left-out stretch starts where the player is">Starts here</button></div>
          <div class="partrow"><label for="skipTo">to</label><input id="skipTo" type="text" inputmode="numeric" placeholder="hh:mm:ss" autocomplete="off" aria-label="The left-out stretch ends at"><button type="button" class="btn sm" id="skipToNow" title="The left-out stretch ends where the player is">Ends here</button><button type="button" class="btn sm primary" id="skipAdd">Leave this out</button></div>
        </details>
        <button type="button" class="btn sm" id="partFromBT" hidden title="Backup Track knows where this part starts, how long the website’s part is, and what the website skips">Take it all from Backup Track</button>
        <label class="eng partall" id="partAllRow"><input type="checkbox" id="partAllBox"><span><b>Write down the whole recording now</b><small>Takes longer this once. Only this part is shown and played. For the next part, press “Part…” and choose it: no new transcribing.</small></span></label>
        <p class="partready" id="partReady" role="status"></p>
      </div>
    </div>`;
  ($('#engineBox') || go).before(f);
  const media = () => (api.cur && api.cur.media) || null, now = () => (media() ? media().currentTime : 0);
  const tidy = el => { const v = parseTime(el.value); if (v != null) el.value = hms(v); return v; };
  // "it is 32:46 long on the website": the end is the start plus that, plus any stretches left out on the way
  const lenToEnd = () => { const a = parseTime($('#partFrom').value), l = parseTime($('#partLen').value); if (a != null && l != null && l > offNow()) $('#partTo').value = hms(recAt({ a, off: offNow(), skips: cleanSkips(sel.skips, a, Infinity) }, l)); ready(); };
  const drawSeg = () => { for (const b of f.querySelectorAll('[data-pzero]')) { const on = (b.dataset.pzero === '1') === zero; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.style.cssText = on ? 'background:var(--accent,#1f6f78);color:var(--accent-ink,#fff);font-weight:700' : 'background:transparent;color:inherit;font-weight:600'; b.textContent = (on ? '● ' : '') + (b.dataset.pzero === '1' ? 'This part’s time, like the site' : 'My file’s time'); } };
  // the line that says what will be written down, so it is plain that the part is set and Transcribe can be pressed
  const ready = () => {
    const el = $('#partReady'), a = parseTime($('#partFrom').value), d = media() ? media().duration || 0 : 0, bRaw = $('#partTo').value.trim(), b = bRaw ? parseTime(bRaw) : d; if (a == null) { el.textContent = ''; return; }
    const ks = cleanSkips(sel.skips, a, b || Infinity), left = ks.reduce((n, k) => n + (k.b - k.a), 0);
    el.textContent = !b || b - a < 1 ? `Set: from ${hms(a)}. Say how long it is on the website (or where it ends), then press ${inSheet ? '“Show only this part”' : 'Transcribe'}.`
      : `Ready: from ${hms(a)} to ${bRaw ? hms(b) : 'the end'} of your recording${bRaw ? ` (${offNow() ? `${hms(offNow())} to ${hms(offNow() + b - a - left)}` : hms(b - a - left)} on the website${ks.length ? `, ${ks.length} stretch${ks.length === 1 ? '' : 'es'} left out` : ''})` : ''}. ${zero ? (offNow() ? `It will count from ${hms(offNow())}, like the website.` : 'It will count from 0:00, like the website.') : 'It will show your recording’s own time.'}${!inSheet && $('#partAllBox').checked ? ' The whole recording will be written down; only this part is shown.' : ''} Press ${inSheet ? '“Show only this part”' : 'Transcribe'}.`;
  };
  const started = () => { $('#partAfter').hidden = false; drawSeg(); ready(); lenFromBT(); toBT(); };
  // what is set here is set in Backup Track too (when it is installed), so the two stay the same
  const toBT = () => { const a = parseTime($('#partFrom').value), m = media(); if (!hasBT || a == null || !m || !m.duration) return; document.dispatchEvent(new CustomEvent('backup-track:set', { detail: JSON.stringify({ begin: r2(a - offNow()), mode: zero ? 'part' : 'file', dur: m.duration, skips: cleanSkips(sel.skips, a, Infinity) }) })); };
  document.addEventListener('backup-track:set-result', e => { let r; try { r = JSON.parse(e.detail); } catch (err) { return; } if (!sel.on) return;
    note(r.ok ? `Backup Track is set the same: ${r.begin < 0 ? `your recording starts at ${hms(-r.begin)} on the website` : `this part starts at ${hms(r.begin)}`} there too, and its clock counts ${zero ? 'like the site' : 'in your file’s time'}.`
      : r.why === 'different' ? `Backup Track has a different recording loaded (“${r.name}”, ${hms(r.dur)} long), so it was left as it is. Choose this same recording there to keep the two in step.`
      : 'Backup Track has no recording chosen yet, so it was not changed. Choose this recording in its panel.'); });
  const drawSkips = () => {
    const ul = $('#partSkips'); ul.textContent = '';
    sel.skips.forEach((k, i) => { const li = document.createElement('li'), sp = document.createElement('span'), x = document.createElement('button'); sp.textContent = `${hms(k.a)} to ${hms(k.b)} (${hms(k.b - k.a)})`; x.type = 'button'; x.textContent = '✕'; x.title = 'Keep this stretch after all'; x.setAttribute('aria-label', `Remove the left-out stretch from ${hms(k.a)}`); x.addEventListener('click', () => { sel.skips.splice(i, 1); sel.touched = true; drawSkips(); lenToEnd(); toBT(); }); li.append(sp, x); ul.appendChild(li); });
    if (sel.skips.length) $('#partSkipBox').open = true;
  };
  const note = t => { const n = $('#partBTNote'); n.textContent = t; n.hidden = !t; };
  f.addEventListener('change', e => {
    if (e.target.name === 'partWhich') { sel.on = e.target.value === 'part'; $('#partRow').hidden = !sel.on; if (sel.on) { document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: 'probe' })); fromBT(true); setTimeout(() => { if (sel.on && !hasBT) note(NOBT); }, 3500); } return; }
    if (e.target.id === 'partFrom') { sel.touched = true; const a = tidy(e.target); if (a != null && media()) media().currentTime = Math.min(a, media().duration || a); /* the player goes there, so you can hear that it is the right place */ if (a != null) started(); lenToEnd(); }
    else if (e.target.id === 'partOff') { sel.touched = true; tidy(e.target); started(); lenToEnd(); toBT(); }
    else if (e.target.id === 'partAllBox') { try { localStorage.setItem('mixtape-part-whole', e.target.checked ? '1' : '0'); } catch (err) {} ready(); }
    else if (e.target.id === 'partTo') { sel.lenSet = true; tidy(e.target); $('#partLen').value = ''; ready(); }
    else if (e.target.id === 'partLen') { sel.lenSet = true; tidy(e.target); $('#partLenHint').textContent = 'Typed by you.'; lenToEnd(); }
    else if (e.target.id === 'skipFrom' || e.target.id === 'skipTo') tidy(e.target);
  });
  $('#partFromNow').addEventListener('click', () => { sel.touched = true; $('#partFrom').value = hms(now()); if (media()) media().pause(); started(); lenToEnd(); });
  $('#partToNow').addEventListener('click', () => { sel.lenSet = true; $('#partTo').value = hms(now()); $('#partLen').value = ''; ready(); });
  $('#skipFromNow').addEventListener('click', () => { $('#skipFrom').value = hms(now()); });
  $('#skipToNow').addEventListener('click', () => { $('#skipTo').value = hms(now()); });
  $('#skipAdd').addEventListener('click', () => {
    const a = parseTime($('#skipFrom').value), b = parseTime($('#skipTo').value);
    if (a == null || b == null || b - a < 0.2) return api.toast('Say where the left-out stretch starts and ends, as hours:minutes:seconds. It must end after it starts.', 6000);
    sel.touched = true; sel.skips = cleanSkips([...sel.skips, { a, b }], 0, Infinity); $('#skipFrom').value = ''; $('#skipTo').value = ''; drawSkips(); lenToEnd(); toBT();
  });
  $('#partPlay').addEventListener('click', () => { const m = media(); if (!m) return; if (m.paused) m.play().catch(() => {}); else m.pause(); });
  f.addEventListener('click', e => {
    const b = e.target.closest('[data-pskip]'), m = media(); if (b && m) m.currentTime = Math.max(0, Math.min(m.duration || 1e9, m.currentTime + +b.dataset.pskip));
    const z = e.target.closest('[data-pzero]'); if (z) { zero = z.dataset.pzero === '1'; try { localStorage.setItem(KEY, zero ? '1' : '0'); } catch (err) {} const box = $('#partClock'); if (box) box.checked = zero; drawSeg(); ready(); toBT(); }
  });
  // the little clock beside the buttons: your recording's time, or counted from the start you set
  setInterval(() => { if (hasBT && sel.on && !sel.lenSet && !$('#partAfter').hidden && !parseTime($('#partLen').value)) lenFromBT(); }, 4000);
  setInterval(() => { const m = media(); if ($('#partRow').hidden || !m) return; const a = parseTime($('#partFrom').value), rel = zero && !$('#partAfter').hidden && a != null; $('#partNow').textContent = rel ? (m.currentTime < a ? '−' : '') + hms(Math.abs(m.currentTime - a)) : hms(m.currentTime); $('#partNow').title = rel ? 'Counted from the start of the part, like the website' : 'The time in your recording'; $('#partPlay').textContent = m.paused ? '▶ Play' : '❚❚ Pause'; }, 250);

  /* Backup Track, when it is installed and following the website: the website's length always comes from it (unless
     you typed one), so it is shown without typing; the start and the skips come from it too if you have not set a start
     yourself, or when you press the button. */
  let hasBT = false;
  const askBT = use => { let done = false; const got = e => { let s; try { s = JSON.parse(e.detail); } catch (err) { return; } if (done || s.begin == null) return; done = true; document.removeEventListener('backup-track:state', got); use(s); };
    document.addEventListener('backup-track:state', got); document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: 'once' })); setTimeout(() => { if (!done) { document.removeEventListener('backup-track:state', got); use(null); } }, 2500); };
  function lenFromBT() { // only the length: after you have set the start yourself
    if (!hasBT || sel.lenSet || !sel.on) return;
    askBT(s => { if (!s || sel.lenSet || !(s.siteLen > 0)) { if (hasBT && !sel.lenSet) $('#partLenHint').textContent = 'Backup Track is installed: press play on the website once and the length appears here. Or type it.'; return; }
      $('#partLen').value = hms(s.siteLen); $('#partLenHint').textContent = 'Taken from the website, through Backup Track.'; lenToEnd(); });
  }
  function fromBT(auto) { // everything: the start, the length and the skips
    if (auto && (sel.touched || !sel.on)) return;
    askBT(s => {
      if (!s) { if (!auto) api.toast('Backup Track did not answer. Open its panel and choose your recording there first.', 6000); return; }
      if (auto && (sel.touched || !s.loaded || !(s.siteLen > 0))) { if (hasBT && !sel.touched) note('Backup Track is installed. Once it is following the website (press play there once), the length appears by itself, or press “Take it all from Backup Track”.'); return; }
      const pts = Array.isArray(s.pts) ? s.pts : [], skips = [];
      for (let i = 1; i < pts.length; i++) { const jump = (pts[i].m - pts[i - 1].m) - (pts[i].p - pts[i - 1].p); if (jump >= 0.2) skips.push({ a: r2(pts[i].m - jump), b: r2(pts[i].m) }); } // where the website jumps ahead, your recording has a stretch it does not
      sel.skips = cleanSkips(skips, 0, Infinity); drawSkips();
      $('#partFrom').value = hms(s.begin); $('#partOff').value = s.begin < 0 ? hms(-s.begin) : ''; if (s.begin < 0) $('#partOffBox').open = true; if (media()) media().currentTime = Math.max(0, Math.min(s.begin, media().duration || s.begin)); $('#partAfter').hidden = false; drawSeg();
      if (s.siteLen > 0) { sel.lenSet = false; $('#partLen').value = hms(s.siteLen); $('#partLenHint').textContent = 'Taken from the website, through Backup Track.'; }
      lenToEnd();
      const said = s.siteLen > 0 ? `Taken from Backup Track: ${s.begin < 0 ? `your recording starts at ${hms(-s.begin)} on the website, which` : `the part starts at ${hms(s.begin)} and`} is ${hms(s.siteLen)} long on the website${sel.skips.length ? `, with ${sel.skips.length} stretch${sel.skips.length === 1 ? '' : 'es'} left out` : ''}. Nothing to type.` : `Taken from Backup Track: the part starts at ${hms(s.begin)}. Press play on the website once, then press the button again to get its length too.`;
      note(said); if (!auto) api.toast(said, 7000);
    });
  }
  document.addEventListener('backup-track:hello', () => { const first = !hasBT; hasBT = true; if ($('#partBTNote').textContent === NOBT) note(''); $('#partFromBT').hidden = false; if (first) fromBT(true); if (sel.on && !$('#partAfter').hidden && !parseTime($('#partLen').value)) lenFromBT(); }); // each time the extension says it is there, the length is asked for if it is still missing
  $('#partFromBT').addEventListener('click', () => { sel.touched = false; sel.lenSet = false; fromBT(false); });
  // the same form, opened for a transcript that already exists: filled in with the part being shown, if there is one
  try { $('#partAllBox').checked = localStorage.getItem('mixtape-part-whole') === '1'; } catch (err) {}
  build.box = f; build.home = () => ($('#engineBox') || go).before(f);
  build.prefill = p => {
    sel = { id: api.cur.track.id, on: true, skips: p ? skipsOf(p).map(k => ({ ...k })) : [], touched: !!p, lenSet: !!p }; $('#partSome').checked = true; $('#partRow').hidden = false; note('');
    $('#partFrom').value = p ? hms(p.a) : '00:00:00'; $('#partOff').value = p && p.off ? hms(p.off) : ''; $('#partOffBox').open = !!(p && p.off); $('#partTo').value = p ? hms(p.b) : ''; $('#partLen').value = p ? hms(siteAt(p, p.b)) : ''; $('#partLenHint').textContent = p ? 'The part being shown now.' : HINT; $('#partAfter').hidden = !p;
    drawSkips(); drawSeg(); ready(); if (!p) { document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: 'probe' })); sel.touched = false; fromBT(true); }
  };
  build.reset = () => { $('#partAll').checked = true; $('#partRow').hidden = true; $('#partAfter').hidden = true; $('#partFrom').value = '00:00:00'; $('#partOff').value = ''; $('#partOffBox').open = false; $('#partTo').value = ''; $('#partLen').value = ''; $('#skipFrom').value = ''; $('#skipTo').value = ''; $('#partLenHint').textContent = HINT; note(''); drawSkips(); ready(); };
}
function fresh() { // another recording: the choice starts again
  const c = api.cur; if (!c || sel.id === c.track.id) return; if (inSheet) closeSheet(true); sel = { id: c.track.id, on: false, skips: [], touched: false, lenSet: false };
  if (build.reset) build.reset();
}

/* ---- the clock's choice, in the player bar; and the part named beside the title ---- */
function bar() {
  const pb = $('#pb'); if (!pb || $('#partClockLab')) return;
  const lab = document.createElement('label'); lab.className = 'fl'; lab.id = 'partClockLab'; lab.hidden = true;
  lab.title = 'This transcript is of the part of the recording that a website has. Ticked: the clock, the slider and the times beside the paragraphs count the way the website does (0:00 at the start of the part, left-out stretches not counted). Unticked: the recording’s own time.';
  const box = document.createElement('input'); box.type = 'checkbox'; box.id = 'partClock'; box.checked = zero; lab.append(box, ' Part’s time'); pb.appendChild(lab);
  box.addEventListener('change', () => { zero = box.checked; try { localStorage.setItem(KEY, zero ? '1' : '0'); } catch (e) {} api.drawAll(); const c = api.cur; if (c && c.media) c.media.dispatchEvent(new Event('timeupdate')); /* the clock redraws at once, also while paused */ });
}
function badge() {
  fresh(); const lab = $('#partClockLab'), p = part(); if (lab) lab.hidden = !p;
  const pbn = $('#partBtn'), c = api.cur; if (pbn) { pbn.hidden = !(c && c.tr && c.tr.mode === 'heard' && c.tr.words.length); pbn.textContent = p ? 'Part: ' + hms(p.a).replace(/^00:/, '') + ' ▾' : 'Part…'; }
  const m = $('#meta'); if (m && p && !m.textContent.includes('part ')) m.textContent += ` · part ${hms(p.a)} to ${hms(p.b)}${skipsOf(p).length ? `, ${skipsOf(p).length} stretch${skipsOf(p).length === 1 ? '' : 'es'} left out` : ''}`;
}

/* ---- a part of a transcript that already exists ----
   The whole recording was transcribed; the website has it in clips. "Part…" in the player bar opens the same form:
   find where the clip starts, how the clock counts, how long it is. "Show only this part" then shows and plays just
   that stretch; nothing is deleted. Choose another part, or "Show the whole recording", whenever you like. */
function sheet() {
  const pb = $('#pb'); if (!pb || $('#partBtn')) return;
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.id = 'partBtn'; b.hidden = true; b.textContent = 'Part…';
  b.title = 'Show and play only one part of this recording (for a website that has it in clips), counted from 0:00 like the website'; pb.appendChild(b);
  const sh = document.createElement('div'); sh.id = 'partSheet'; sh.className = 'partsheet'; sh.hidden = true; sh.setAttribute('role', 'dialog'); sh.setAttribute('aria-label', 'Show only one part of this recording');
  sh.innerHTML = `<div class="partsheet-h"><b>Show only one part of this recording</b><button type="button" class="btn sm" id="partSheetX" aria-label="Close">✕</button></div>
    <p class="parthint">For a website that has this recording in clips. The whole transcript is kept; only what is shown and played changes.</p>
    <div class="partsheet-body"></div>
    <div class="partsheet-f"><button type="button" class="btn primary" id="partApply">Show only this part</button><button type="button" class="btn" id="partWhole">Show the whole recording</button></div>`;
  document.body.appendChild(sh);
  b.addEventListener('click', () => (sh.hidden ? openSheet() : closeSheet()));
  $('#partSheetX').addEventListener('click', () => closeSheet());
  sh.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); $('#partBtn').focus(); } });
  const redraw = () => { api.drawAll(); const c = api.cur; if (c && c.media) c.media.dispatchEvent(new Event('timeupdate')); };
  $('#partApply').addEventListener('click', async () => {
    const c = api.cur, p = partChosen(c); if (!p) return; c.tr.part = p; try { await api.save(); } catch (e) { return; }
    closeSheet(); if (c.media && (c.media.currentTime < p.a || c.media.currentTime >= p.b)) c.media.currentTime = p.a; redraw();
    api.toast(`Showing only ${hms(p.a)} to ${hms(p.b)}. The rest of the transcript is kept: press Part to choose another part or show it all.`, 7000);
  });
  $('#partWhole').addEventListener('click', async () => { const c = api.cur; if (c.tr.part) { delete c.tr.part; try { await api.save(); } catch (e) { return; } } closeSheet(); redraw(); api.toast('Showing the whole recording.', 3000); });
}
function openSheet() { const c = api.cur; if (!c || !c.tr || !build.box) return; inSheet = true; $('#partSheet').querySelector('.partsheet-body').appendChild(build.box); build.box.classList.add('insheet'); build.prefill(part()); $('#partSheet').hidden = false; $('#partPlay').focus(); }
function closeSheet(quiet) { const sh = $('#partSheet'); if (!sh || sh.hidden) return; sh.hidden = true; inSheet = false; build.box.classList.remove('insheet'); build.home(); const c = api.cur; sel = { id: quiet || !c ? null : c.track.id, on: false, skips: [], touched: false, lenSet: false }; build.reset(); }

export function initPart(a) {
  api = a; build(); bar(); sheet();
  const m = $('#meta'); if (m) new MutationObserver(badge).observe(m, { childList: true, characterData: true, subtree: true });
    setInterval(() => { // only the part plays: it stops at its end, and a stretch the website leaves out is jumped over
    const p = part(), c = api.cur; if (!p || inSheet || !c || !c.media || c.media.paused) return; const m = c.media, t = m.currentTime, k = skipsOf(p).find(k => t >= k.a && t < k.b - 0.05);
    if (k) m.currentTime = k.b; else if (t >= p.b) { m.pause(); m.currentTime = Math.max(p.a, p.b - 0.05); } else if (t < p.a - 0.3) m.currentTime = p.a;
  }, 200);
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__part = { partRecForSite, get zero() { return zero; }, get sel() { return sel; }, part, hms, parseTime, siteAt, recAt, partTrim };
}
