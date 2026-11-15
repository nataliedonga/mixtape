/* Transcribing only a part of a recording, and a clock that counts from the start of that part.

   A long recording is often worked on in parts (a 3½-hour hearing whose transcript is split in three). Before
   transcribing you can say which part you want: from one moment to another, typed as hours:minutes:seconds or taken
   from where the player is. Only that stretch is written down. The transcript remembers its part.

   "Part's time" (in the player bar) then makes the clock, the slider and the times beside the paragraphs count from
   the start of the part, 0:00, the way a site that only has that part counts. The same idea as Backup Track's
   "This part's time, like the site". Untick it to see the recording's own time again. */
const $ = s => document.querySelector(s), KEY = 'mixtape-part-clock';
let api, sel = { id: null, on: false }, zero = true;
try { zero = localStorage.getItem(KEY) !== '0'; } catch (e) {}

export const hms = t => { t = Math.max(0, t || 0); let whole = Math.floor(t), frac = Math.round((t - whole) * 10); if (frac === 10) { whole++; frac = 0; } const p = n => String(n).padStart(2, '0'); return p(Math.floor(whole / 3600)) + ':' + p(Math.floor(whole / 60) % 60) + ':' + p(whole % 60) + (frac ? '.' + frac : ''); };
// "00:20:00", "20:00", "1:05:30", "75", "20m", "1h 5m": seconds, or null if it is not a time
export const parseTime = v => { v = String(v).trim().toLowerCase().replace(',', '.'); if (!v) return null; let s = null, m;
  if (/^\d+(\.\d+)?$/.test(v)) s = +v;
  else if ((m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?(\.\d+)?$/.exec(v))) s = m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +(m[4] || 0) : +m[1] * 60 + +m[2] + +(m[4] || 0);
  else if ((m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/.exec(v)) && (m[1] || m[2] || m[3])) s = +(m[1] || 0) * 3600 + +(m[2] || 0) * 60 + +(m[3] || 0);
  return s == null || !isFinite(s) ? null : s; };

const part = () => { const c = api && api.cur; return c && c.tr && c.tr.part && c.tr.part.b > c.tr.part.a ? c.tr.part : null; };
const counting = () => zero && !!part();

/* ---- what the page asks ---- */
// the clock and the slider: in the recording's own time, or counted from the start of the part
export function partClock(cur, t, d) { const p = counting() ? part() : null; if (!p) return { now: t, total: d, frac: d ? t / d : 0 }; const len = p.b - p.a; return { now: Math.max(0, Math.min(len, t - p.a)), total: len, frac: Math.max(0, Math.min(1, (t - p.a) / len)) }; }
export function partSeek(cur, f, d) { const p = counting() ? part() : null; return p ? p.a + f * (p.b - p.a) : f * d; }
export function partShow(t) { const p = counting() ? part() : null; return p ? Math.max(0, t - p.a) : t; }
// the text files saved from a part count the same way as the clock does (the .json keeps the recording's own times, so it still opens with its recording)
export function partExport(r) { const p = counting() ? part() : null; if (!p) return r; return { ...r, words: r.words.map(w => w.s == null ? w : { ...w, s: Math.max(0, w.s - p.a), e: w.e == null ? w.e : Math.max(0, w.e - p.a) }) }; }
// the part chosen for a new transcript: { a, b } in seconds; null for the whole recording; false if what was typed cannot be used (said in a toast)
export function partChosen(cur) {
  if (!cur || sel.id !== cur.track.id || !sel.on) return null;
  const d = cur.media.duration || cur.track.duration || 0, a = parseTime($('#partFrom').value), bRaw = $('#partTo').value.trim(), b = bRaw ? parseTime(bRaw) : d;
  if (a == null || b == null) { api.toast('Type the part’s times as hours:minutes:seconds, like 01:39:00.', 6000); return false; }
  if (d && a >= d) { api.toast(`This recording is ${hms(d)} long, so the part cannot start at ${hms(a)}.`, 6000); return false; }
  const end = d ? Math.min(b, d) : b; if (end - a < 1) { api.toast('The part must end after it starts.', 5000); return false; }
  return { a: Math.round(a * 100) / 100, b: Math.round(end * 100) / 100 };
}

/* ---- choosing the part, in the "Write down what is said" card ---- */
function build() {
  const go = $('#goHeard'); if (!go || $('#partBox')) return;
  const f = document.createElement('fieldset'); f.id = 'partBox'; f.className = 'engine partbox';
  f.innerHTML = `<legend>Is this to follow along with a website?</legend>
    <label class="eng"><input type="radio" name="partWhich" id="partAll" value="all" checked><span><b>No: write down the whole recording</b></span></label>
    <label class="eng"><input type="radio" name="partWhich" id="partSome" value="part"><span><b>Yes: the website has only a part of it</b><small>Say where that part starts in your recording. Only that part is written down, and it then counts from 0:00, the same as the website.</small></span></label>
    <div id="partRow" hidden>
      <div class="partplay" role="group" aria-label="Play the recording to find the place">
        <button type="button" class="btn sm" data-pskip="-10" title="Back 10 seconds">−10 s</button><button type="button" class="btn sm" data-pskip="-5" title="Back 5 seconds">−5 s</button>
        <button type="button" class="btn sm primary" id="partPlay" title="Play or pause the recording, to find where the part starts">▶ Play</button>
        <button type="button" class="btn sm" data-pskip="5" title="Forward 5 seconds">+5 s</button><button type="button" class="btn sm" data-pskip="10" title="Forward 10 seconds">+10 s</button>
        <span class="partnow" id="partNow" aria-live="off">00:00:00</span>
      </div>
      <div class="partrow">
        <label for="partFrom">Starts at</label><input id="partFrom" type="text" inputmode="numeric" value="00:00:00" placeholder="00:00:00" autocomplete="off" aria-label="The part starts at (hours:minutes:seconds)"><button type="button" class="btn sm" id="partFromNow" title="The place the player is at becomes the start of the part">This part starts here</button>
      </div>
      <div class="partrow">
        <label for="partTo">Ends at</label><input id="partTo" type="text" inputmode="numeric" placeholder="the end" autocomplete="off" aria-label="The part ends at (hours:minutes:seconds); empty means the end of the recording"><button type="button" class="btn sm" id="partToNow" title="The place the player is at becomes the end of the part">It ends here</button>
      </div>
      <div class="partrow"><label for="partLen">or it is</label><input id="partLen" type="text" inputmode="numeric" placeholder="00:32:46" autocomplete="off" aria-label="How long the part is on the website (hours:minutes:seconds)"><span class="parthint">long on the website</span></div>
      <button type="button" class="btn sm" id="partFromBT" hidden title="Backup Track knows where this part starts in your recording and how long the website’s part is">Take both from Backup Track</button>
    </div>`;
  ($('#engineBox') || go).before(f);
  const show = () => { $('#partRow').hidden = !sel.on; }, media = () => (api.cur && api.cur.media) || null, now = () => (media() ? media().currentTime : 0);
  const tidy = el => { const v = parseTime(el.value); if (v != null) el.value = hms(v); return v; };
  f.addEventListener('change', e => {
    if (e.target.name === 'partWhich') { sel.on = e.target.value === 'part'; show(); if (sel.on) { $('#partFrom').focus(); document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: 'probe' })); } }
    else if (e.target.id === 'partFrom') { const a = tidy(e.target); if (a != null && media()) media().currentTime = Math.min(a, media().duration || a); /* the player goes there, so you can hear that it is the right place */ lenToEnd(); }
    else if (e.target.id === 'partTo') { tidy(e.target); $('#partLen').value = ''; }
    else if (e.target.id === 'partLen') { tidy(e.target); lenToEnd(); }
  });
  // "it is 32:46 long on the website": the end is the start plus that
  const lenToEnd = () => { const a = parseTime($('#partFrom').value), l = parseTime($('#partLen').value); if (a != null && l != null && l > 0) $('#partTo').value = hms(a + l); };
  $('#partFromNow').addEventListener('click', () => { $('#partFrom').value = hms(now()); lenToEnd(); });
  $('#partToNow').addEventListener('click', () => { $('#partTo').value = hms(now()); $('#partLen').value = ''; });
  $('#partPlay').addEventListener('click', () => { const m = media(); if (!m) return; if (m.paused) m.play().catch(() => {}); else m.pause(); });
  f.addEventListener('click', e => { const b = e.target.closest('[data-pskip]'), m = media(); if (b && m) m.currentTime = Math.max(0, Math.min(m.duration || 1e9, m.currentTime + +b.dataset.pskip)); });
  setInterval(() => { const m = media(); if ($('#partRow').hidden || !m) return; $('#partNow').textContent = hms(m.currentTime); $('#partPlay').textContent = m.paused ? '▶ Play' : '❚❚ Pause'; }, 250);
  // Backup Track (the browser extension), when it is installed: it already knows the start and the website's length
  document.addEventListener('backup-track:hello', () => { $('#partFromBT').hidden = false; });
  $('#partFromBT').addEventListener('click', () => {
    let done = false; const got = e => { let s; try { s = JSON.parse(e.detail); } catch (err) { return; } if (done || s.begin == null) return; done = true; document.removeEventListener('backup-track:state', got);
      $('#partFrom').value = hms(s.begin); if (s.siteLen > 0) { $('#partLen').value = hms(s.siteLen); lenToEnd(); } if (media()) media().currentTime = Math.min(s.begin, media().duration || s.begin);
      api.toast(s.siteLen > 0 ? `Taken from Backup Track: starts at ${hms(s.begin)}, ${hms(s.siteLen)} long.` : `Taken from Backup Track: starts at ${hms(s.begin)}. Press play on the website once and try again to get its length too.`, 7000); };
    document.addEventListener('backup-track:state', got); document.dispatchEvent(new CustomEvent('backup-track:listen', { detail: 'once' }));
    setTimeout(() => { if (!done) { document.removeEventListener('backup-track:state', got); api.toast('Backup Track did not answer. Open its panel and choose your recording there first.', 6000); } }, 2500);
  });
}
function fresh() { // another recording: the choice starts again
  const c = api.cur; if (!c || sel.id === c.track.id) return; sel = { id: c.track.id, on: false };
  if ($('#partBox')) { $('#partAll').checked = true; $('#partRow').hidden = true; $('#partFrom').value = '00:00:00'; $('#partTo').value = ''; $('#partLen').value = ''; }
}

/* ---- the clock's choice, in the player bar; and the part named beside the title ---- */
function bar() {
  const pb = $('#pb'); if (!pb || $('#partClockLab')) return;
  const lab = document.createElement('label'); lab.className = 'fl'; lab.id = 'partClockLab'; lab.hidden = true;
  lab.title = 'This transcript is of one part of the recording. Ticked: the clock, the slider and the times beside the paragraphs count from the start of the part (0:00), like a site that only has that part. Unticked: the recording’s own time.';
  const box = document.createElement('input'); box.type = 'checkbox'; box.id = 'partClock'; box.checked = zero; lab.append(box, ' Part’s time'); pb.appendChild(lab);
  box.addEventListener('change', () => { zero = box.checked; try { localStorage.setItem(KEY, zero ? '1' : '0'); } catch (e) {} api.drawAll(); const c = api.cur; if (c && c.media) c.media.dispatchEvent(new Event('timeupdate')); /* the clock redraws at once, also while paused */ });
}
function badge() {
  fresh(); const lab = $('#partClockLab'), p = part(); if (lab) lab.hidden = !p;
  const m = $('#meta'); if (m && p && !m.textContent.includes('part ')) m.textContent += ` · part ${hms(p.a)} to ${hms(p.b)}`;
}

export function initPart(a) {
  api = a; build(); bar();
  const m = $('#meta'); if (m) new MutationObserver(badge).observe(m, { childList: true, characterData: true, subtree: true });
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__part = { get zero() { return zero; }, part, hms, parseTime };
}
