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
const $ = s => document.querySelector(s), KEY = 'mixtape-part-clock';
let api, sel = { id: null, on: false, skips: [], touched: false }, zero = true;
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
// p = { a, b, skips: [{ a, b }] }, all in the recording's time; skips are sorted and do not overlap
const skipsOf = p => p.skips || [];
export const siteAt = (p, t) => { let s = t - p.a; for (const k of skipsOf(p)) { if (t >= k.b) s -= k.b - k.a; else if (t > k.a) s -= t - k.a; } return s; }; // the website's time when the recording is at t
export const recAt = (p, s) => { let t = p.a + s; for (const k of skipsOf(p)) if (t >= k.a) t += k.b - k.a; return t; };                                         // and the other way round
const cleanSkips = (list, a, b) => { // inside the part, in order, joined where they touch
  const out = []; for (const k of [...list].filter(k => k && isFinite(k.a) && isFinite(k.b)).map(k => ({ a: r2(Math.max(a, k.a)), b: r2(Math.min(b, k.b)) })).filter(k => k.b - k.a >= 0.2).sort((x, y) => x.a - y.a)) { const last = out[out.length - 1]; if (last && k.a <= last.b) last.b = Math.max(last.b, k.b); else out.push(k); } return out; };
const part = () => { const c = api && api.cur; return c && c.tr && c.tr.part && c.tr.part.b > c.tr.part.a ? c.tr.part : null; };
const counting = () => zero && !!part();

/* ---- what the page asks ---- */
export function partClock(cur, t, d) { const p = counting() ? part() : null; if (!p) return { now: t, total: d, frac: d ? t / d : 0 }; const len = siteAt(p, p.b), s = Math.max(0, Math.min(len, siteAt(p, t))); return { now: s, total: len, frac: len ? s / len : 0 }; }
export function partSeek(cur, f, d) { const p = counting() ? part() : null; return p ? recAt(p, f * siteAt(p, p.b)) : f * d; }
export function partShow(t) { const p = counting() ? part() : null; return p ? Math.max(0, siteAt(p, t)) : t; }
// the text files saved from a part count the same way as the clock does (the .json keeps the recording's own times, so it still opens with its recording)
export function partExport(r) { const p = counting() ? part() : null; if (!p) return r; return { ...r, words: r.words.map(w => w.s == null ? w : { ...w, s: Math.max(0, siteAt(p, w.s)), e: w.e == null ? w.e : Math.max(0, siteAt(p, w.e)) }) }; }
// once the part is written down: words inside a stretch the website leaves out are taken away, and what follows starts a new paragraph
export function partTrim(tr) {
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
  return { a: r2(a), b: r2(end), ...(skips.length ? { skips } : {}) };
}

/* ---- choosing the part, in the "Write down what is said" card ---- */
function build() {
  const go = $('#goHeard'); if (!go || $('#partBox')) return;
  const f = document.createElement('fieldset'); f.id = 'partBox'; f.className = 'engine partbox';
  f.innerHTML = `<legend>Is this to follow along with a website?</legend>
    <label class="eng"><input type="radio" name="partWhich" id="partAll" value="all" checked><span><b>No: write down the whole recording</b></span></label>
    <label class="eng"><input type="radio" name="partWhich" id="partSome" value="part"><span><b>Yes: the website has only a part of it</b><small>Only what the website has is written down, and it then counts from 0:00, the same as the website.</small></span></label>
    <div id="partRow" hidden>
      <p class="partnote" id="partBTNote" hidden></p>
      <div class="partplay" role="group" aria-label="Play the recording to find the place">
        <button type="button" class="btn sm" data-pskip="-10" title="Back 10 seconds">−10 s</button><button type="button" class="btn sm" data-pskip="-5" title="Back 5 seconds">−5 s</button>
        <button type="button" class="btn sm primary" id="partPlay" title="Play or pause the recording, to find a place in it">▶ Play</button>
        <button type="button" class="btn sm" data-pskip="5" title="Forward 5 seconds">+5 s</button><button type="button" class="btn sm" data-pskip="10" title="Forward 10 seconds">+10 s</button>
        <span class="partnow" id="partNow" aria-live="off">00:00:00</span>
      </div>
      <div class="partrow"><label for="partFrom">Starts at</label><input id="partFrom" type="text" inputmode="numeric" value="00:00:00" placeholder="00:00:00" autocomplete="off" aria-label="The part starts at (hours:minutes:seconds)"><button type="button" class="btn sm" id="partFromNow" title="The place the player is at becomes the start of the part">This part starts here</button></div>
      <div class="partrow"><label for="partTo">Ends at</label><input id="partTo" type="text" inputmode="numeric" placeholder="the end" autocomplete="off" aria-label="The part ends at (hours:minutes:seconds); empty means the end of the recording"><button type="button" class="btn sm" id="partToNow" title="The place the player is at becomes the end of the part">It ends here</button></div>
      <div class="partrow"><label for="partLen">or it is</label><input id="partLen" type="text" inputmode="numeric" placeholder="00:32:46" autocomplete="off" aria-label="How long the part is on the website (hours:minutes:seconds)"><span class="parthint">long on the website</span></div>
      <p class="partsub">Stretches the website leaves out <span class="parthint">(that your recording still has; if any)</span></p>
      <ul class="partskips" id="partSkips" aria-label="Stretches the website leaves out"></ul>
      <div class="partrow"><label for="skipFrom">From</label><input id="skipFrom" type="text" inputmode="numeric" placeholder="00:00:00" autocomplete="off" aria-label="The left-out stretch starts at"><button type="button" class="btn sm" id="skipFromNow" title="The left-out stretch starts where the player is">Starts here</button></div>
      <div class="partrow"><label for="skipTo">to</label><input id="skipTo" type="text" inputmode="numeric" placeholder="00:00:00" autocomplete="off" aria-label="The left-out stretch ends at"><button type="button" class="btn sm" id="skipToNow" title="The left-out stretch ends where the player is">Ends here</button><button type="button" class="btn sm primary" id="skipAdd">Leave this out</button></div>
      <button type="button" class="btn sm" id="partFromBT" hidden title="Backup Track knows where this part starts, how long the website’s part is, and what the website skips">Take it all from Backup Track again</button>
    </div>`;
  ($('#engineBox') || go).before(f);
  const media = () => (api.cur && api.cur.media) || null, now = () => (media() ? media().currentTime : 0);
  const tidy = el => { const v = parseTime(el.value); if (v != null) el.value = hms(v); return v; };
  // "it is 32:46 long on the website": the end is the start plus that, plus any stretches left out on the way
  const lenToEnd = () => { const a = parseTime($('#partFrom').value), l = parseTime($('#partLen').value); if (a != null && l != null && l > 0) $('#partTo').value = hms(recAt({ a, skips: cleanSkips(sel.skips, a, Infinity) }, l)); };
  const drawSkips = () => {
    const ul = $('#partSkips'); ul.textContent = '';
    sel.skips.forEach((k, i) => { const li = document.createElement('li'), sp = document.createElement('span'), x = document.createElement('button'); sp.textContent = `${hms(k.a)} to ${hms(k.b)} (${hms(k.b - k.a)})`; x.type = 'button'; x.textContent = '✕'; x.title = 'Keep this stretch after all'; x.setAttribute('aria-label', `Remove the left-out stretch from ${hms(k.a)}`); x.addEventListener('click', () => { sel.skips.splice(i, 1); sel.touched = true; drawSkips(); lenToEnd(); }); li.append(sp, x); ul.appendChild(li); });
  };
  const note = t => { const n = $('#partBTNote'); n.textContent = t; n.hidden = !t; };
  f.addEventListener('change', e => {
    if (e.target.name === 'partWhich') { sel.on = e.target.value === 'part'; $('#partRow').hidden = !sel.on; if (sel.on) { document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: 'probe' })); fromBT(true); } return; }
    if (e.target.id === 'partFrom') { sel.touched = true; const a = tidy(e.target); if (a != null && media()) media().currentTime = Math.min(a, media().duration || a); /* the player goes there, so you can hear that it is the right place */ lenToEnd(); }
    else if (e.target.id === 'partTo') { sel.touched = true; tidy(e.target); $('#partLen').value = ''; }
    else if (e.target.id === 'partLen') { sel.touched = true; tidy(e.target); lenToEnd(); }
    else if (e.target.id === 'skipFrom' || e.target.id === 'skipTo') tidy(e.target);
  });
  $('#partFromNow').addEventListener('click', () => { sel.touched = true; $('#partFrom').value = hms(now()); lenToEnd(); });
  $('#partToNow').addEventListener('click', () => { sel.touched = true; $('#partTo').value = hms(now()); $('#partLen').value = ''; });
  $('#skipFromNow').addEventListener('click', () => { $('#skipFrom').value = hms(now()); });
  $('#skipToNow').addEventListener('click', () => { $('#skipTo').value = hms(now()); });
  $('#skipAdd').addEventListener('click', () => {
    const a = parseTime($('#skipFrom').value), b = parseTime($('#skipTo').value);
    if (a == null || b == null || b - a < 0.2) return api.toast('Say where the left-out stretch starts and ends, as hours:minutes:seconds. It must end after it starts.', 6000);
    sel.touched = true; sel.skips = cleanSkips([...sel.skips, { a, b }], 0, Infinity); $('#skipFrom').value = ''; $('#skipTo').value = ''; drawSkips(); lenToEnd();
  });
  $('#partPlay').addEventListener('click', () => { const m = media(); if (!m) return; if (m.paused) m.play().catch(() => {}); else m.pause(); });
  f.addEventListener('click', e => { const b = e.target.closest('[data-pskip]'), m = media(); if (b && m) m.currentTime = Math.max(0, Math.min(m.duration || 1e9, m.currentTime + +b.dataset.pskip)); });
  setInterval(() => { const m = media(); if ($('#partRow').hidden || !m) return; $('#partNow').textContent = hms(m.currentTime); $('#partPlay').textContent = m.paused ? '▶ Play' : '❚❚ Pause'; }, 250);

  /* Backup Track, when it is installed: the start, the website's length and what the website skips come from it, so
     nothing has to be typed. Asked by itself when "Yes" is chosen (unless you have already typed something), and again
     with the button. */
  let hasBT = false;
  function fromBT(auto) {
    if (auto && (sel.touched || !sel.on)) return;
    let done = false; const got = e => {
      let s; try { s = JSON.parse(e.detail); } catch (err) { return; } if (done || s.begin == null) return; done = true; document.removeEventListener('backup-track:state', got);
      if (auto && (sel.touched || !s.loaded || !(s.siteLen > 0))) { if (hasBT && !sel.touched) note('Backup Track is installed. Once it is following the website (press play there once), press “Take it all from Backup Track again” and nothing needs typing.'); return; }
      const pts = Array.isArray(s.pts) ? s.pts : [], skips = [];
      for (let i = 1; i < pts.length; i++) { const jump = (pts[i].m - pts[i - 1].m) - (pts[i].p - pts[i - 1].p); if (jump >= 0.2) skips.push({ a: r2(pts[i].m - jump), b: r2(pts[i].m) }); } // where the website jumps ahead, your recording has a stretch it does not
      sel.skips = cleanSkips(skips, 0, Infinity); drawSkips();
      $('#partFrom').value = hms(s.begin); if (s.siteLen > 0) { $('#partLen').value = hms(s.siteLen); lenToEnd(); } if (media()) media().currentTime = Math.min(s.begin, media().duration || s.begin);
      const said = s.siteLen > 0 ? `Taken from Backup Track: the part starts at ${hms(s.begin)} and is ${hms(s.siteLen)} long on the website${sel.skips.length ? `, with ${sel.skips.length} stretch${sel.skips.length === 1 ? '' : 'es'} left out` : ''}. Nothing to type.` : `Taken from Backup Track: the part starts at ${hms(s.begin)}. Press play on the website once, then press the button again to get its length too.`;
      note(said); if (!auto) api.toast(said, 7000);
    };
    document.addEventListener('backup-track:state', got); document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: 'once' }));
    setTimeout(() => { if (!done) { document.removeEventListener('backup-track:state', got); if (!auto) api.toast('Backup Track did not answer. Open its panel and choose your recording there first.', 6000); } }, 2500);
  }
  document.addEventListener('backup-track:hello', () => { const first = !hasBT; hasBT = true; $('#partFromBT').hidden = false; if (first) fromBT(true); });
  $('#partFromBT').addEventListener('click', () => { sel.touched = false; fromBT(false); });
  build.reset = () => { $('#partAll').checked = true; $('#partRow').hidden = true; $('#partFrom').value = '00:00:00'; $('#partTo').value = ''; $('#partLen').value = ''; $('#skipFrom').value = ''; $('#skipTo').value = ''; note(''); drawSkips(); };
}
function fresh() { // another recording: the choice starts again
  const c = api.cur; if (!c || sel.id === c.track.id) return; sel = { id: c.track.id, on: false, skips: [], touched: false };
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
  const m = $('#meta'); if (m && p && !m.textContent.includes('part ')) m.textContent += ` · part ${hms(p.a)} to ${hms(p.b)}${skipsOf(p).length ? `, ${skipsOf(p).length} stretch${skipsOf(p).length === 1 ? '' : 'es'} left out` : ''}`;
}

export function initPart(a) {
  api = a; build(); bar();
  const m = $('#meta'); if (m) new MutationObserver(badge).observe(m, { childList: true, characterData: true, subtree: true });
  // while the page plays in "Part's time", a stretch the website leaves out is jumped over, as the website does
  setInterval(() => { const p = counting() ? part() : null, c = api.cur; if (!p || !c || !c.media || c.media.paused) return; const t = c.media.currentTime, k = skipsOf(p).find(k => t >= k.a && t < k.b - 0.05); if (k) c.media.currentTime = k.b; }, 200);
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__part = { get zero() { return zero; }, get sel() { return sel; }, part, hms, parseTime, siteAt, recAt, partTrim };
}
