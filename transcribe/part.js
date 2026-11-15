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
  f.innerHTML = `<legend>How much of it?</legend>
    <label class="eng"><input type="radio" name="partWhich" id="partAll" value="all" checked><span><b>All of it</b></span></label>
    <label class="eng"><input type="radio" name="partWhich" id="partSome" value="part"><span><b>Only a part</b><small>For a long recording that you work on in parts. Play it below to find the place, or type the times.</small></span></label>
    <div class="partrow" id="partRow" hidden>
      <label for="partFrom">From</label><input id="partFrom" type="text" inputmode="numeric" value="00:00:00" placeholder="00:00:00" autocomplete="off" aria-label="The part starts at (hours:minutes:seconds)"><button type="button" class="btn sm" id="partFromNow" title="Use the moment the player is at">Where the player is</button>
      <label for="partTo">to</label><input id="partTo" type="text" inputmode="numeric" placeholder="the end" autocomplete="off" aria-label="The part ends at (hours:minutes:seconds); empty means the end of the recording"><button type="button" class="btn sm" id="partToNow" title="Use the moment the player is at">Where the player is</button>
    </div>`;
  ($('#engineBox') || go).before(f);
  const show = () => { $('#partRow').hidden = !sel.on; };
  f.addEventListener('change', e => { if (e.target.name === 'partWhich') { sel.on = e.target.value === 'part'; show(); if (sel.on) $('#partFrom').focus(); } else if (e.target.id === 'partFrom' || e.target.id === 'partTo') { const v = parseTime(e.target.value); if (v != null) e.target.value = hms(v); } });
  const now = () => (api.cur && api.cur.media ? api.cur.media.currentTime : 0);
  $('#partFromNow').addEventListener('click', () => { $('#partFrom').value = hms(now()); });
  $('#partToNow').addEventListener('click', () => { $('#partTo').value = hms(now()); });
}
function fresh() { // another recording: the choice starts again
  const c = api.cur; if (!c || sel.id === c.track.id) return; sel = { id: c.track.id, on: false };
  if ($('#partBox')) { $('#partAll').checked = true; $('#partRow').hidden = true; $('#partFrom').value = '00:00:00'; $('#partTo').value = ''; }
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
