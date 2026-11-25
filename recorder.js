/* Record: the sound of another browser tab, of the whole computer, or of the microphone, straight into the library.

   How it records. The browser itself asks which tab or screen to share (a web page may only hear another tab's sound
   that way, and only after you choose it): for a tab, tick "Also share tab audio"; for the whole screen on Windows,
   tick "Also share system audio". Only the sound is kept; the picture is let go at once. The sound is written as it
   comes, with Opus in a WebM file (AAC in an M4A where Opus cannot be written), by mediabunny (MPL-2.0, already part
   of Mixtape), so the file knows its own length. When you stop (or the shared tab is closed) it is added to your
   library, under the album "Recordings". Nothing is sent anywhere.

   Record only what you have the right to record. */
import * as M from './vendor/mediabunny/mediabunny.min.mjs';
const $ = s => document.querySelector(s), esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let api, rec = null;
const STYLE = `
.mxrec-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #E5484D; margin-right: 6px; vertical-align: -1px; }
.mxrec-sheet { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: #0008; }
.mxrec-sheet[hidden] { display: none; }
.mxrec-box { width: min(460px, calc(100vw - 32px)); padding: 18px; border-radius: 16px; background: var(--surface, #1b1b22); color: var(--text, #eee); border: 1px solid var(--line, #fff2); box-shadow: 0 20px 60px #0008; font: 15px/1.45 var(--f-ui, system-ui, sans-serif); }
.mxrec-box h3 { margin: 0 0 4px; font-size: 18px; } .mxrec-box p { margin: 0 0 12px; opacity: .8; font-size: 14px; }
.mxrec-src { display: grid; gap: 8px; margin: 10px 0 14px; }
.mxrec-src button { text-align: left; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--line, #fff3); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.mxrec-src button:hover, .mxrec-src button:focus-visible { border-color: var(--accent, #c7a3ff); outline: none; }
.mxrec-src b { display: block; } .mxrec-src small { display: block; opacity: .72; font-size: 13px; }
.mxrec-acts { display: flex; justify-content: flex-end; gap: 8px; }
.mxrec-acts button { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line, #fff3); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.mxrec-bar { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 85; display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; border-radius: 999px; background: #2a1517; color: #fff; border: 1px solid #E5484D88; box-shadow: 0 10px 30px #0007; font: 600 14px/1 var(--f-ui, system-ui, sans-serif); }
.mxrec-bar[hidden] { display: none; }
.mxrec-bar .t { font-variant-numeric: tabular-nums; min-width: 4.2em; }
.mxrec-bar .lv { width: 90px; height: 8px; border-radius: 4px; background: #ffffff22; overflow: hidden; } .mxrec-bar .lv i { display: block; height: 100%; width: 0; background: #7BD88F; transition: width .08s; }
.mxrec-bar button { padding: 7px 12px; border-radius: 999px; border: 1px solid #fff4; background: transparent; color: #fff; font: inherit; cursor: pointer; }
.mxrec-bar button.stop { background: #E5484D; border-color: #E5484D; }
.mxrec-bar .src { font-weight: 500; opacity: .8; max-width: 22ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mxrec-bar.paused .mxrec-dot { background: #aaa; }
@media (prefers-reduced-motion: no-preference) { .mxrec-bar:not(.paused) .mxrec-dot { animation: mxrecblink 1.2s infinite; } }
@keyframes mxrecblink { 50% { opacity: .25; } }`;

const SOURCES = {
  tab: { title: 'Sound from a browser tab', how: 'Choose the tab in the list the browser shows, and tick “Also share tab audio”.', sure: 'a website, a video, a call in the browser' },
  screen: { title: 'Sound of the whole computer', how: 'Choose “Entire screen” and tick “Also share system audio”. Everything you hear is recorded, Mixtape included.', sure: 'an app outside the browser' },
  mic: { title: 'Microphone', how: 'The browser asks once to use the microphone.', sure: 'your own voice, a room' },
};
const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60, p = n => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : m) + ':' + p(x); };
const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;

/* the stream for a source; only its sound is kept */
async function streamFor(kind) {
  const quiet = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  if (kind === 'mic') return navigator.mediaDevices.getUserMedia({ audio: quiet });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('This browser cannot record the sound of another tab. Use Chrome or Edge on a computer.');
  const s = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: kind === 'tab' ? 'browser' : 'monitor' }, audio: quiet, systemAudio: 'include', preferCurrentTab: false, selfBrowserSurface: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: kind === 'screen' ? 'include' : 'exclude' });
  if (!s.getAudioTracks().length) { s.getTracks().forEach(t => t.stop()); throw Object.assign(new Error(kind === 'tab' ? 'No sound was shared. Try again and tick “Also share tab audio” at the bottom of the browser’s list.' : 'No sound was shared. Try again and tick “Also share system audio” in the browser’s list.'), { soft: true }); }
  return s;
}

async function start(kind) {
  if (rec) return;
  let stream; try { stream = await streamFor(kind); } catch (e) { if (e.name === 'NotAllowedError' || e.name === 'AbortError') return api.toast(kind === 'mic' ? 'The microphone was not allowed, so nothing is recorded.' : 'Nothing was chosen, so nothing is recorded.', 4500); return api.toast(e.message || String(e), 8000); }
  const track = stream.getAudioTracks()[0], vl = (stream.getVideoTracks()[0] && stream.getVideoTracks()[0].label) || '', label = kind === 'mic' ? 'Microphone' : vl && !/^[a-z-]+:\/\//i.test(vl) && !/^(screen|window):/i.test(vl) ? vl : kind === 'tab' ? 'A browser tab' : 'The whole computer'; // a tab's own title when the browser gives one, not an internal address
  stream.getVideoTracks().forEach(t => { t.enabled = false; }); // the picture is not kept (stopping it would end the sharing in some browsers)
  const opus = await M.canEncodeAudio('opus').catch(() => false), fmt = opus ? new M.WebMOutputFormat() : new M.Mp4OutputFormat(), ext = opus ? '.webm' : '.m4a', type = opus ? 'audio/webm' : 'audio/mp4';
  const output = new M.Output({ format: fmt, target: new M.BufferTarget() });
  const src = new M.MediaStreamAudioTrackSource(track, { codec: opus ? 'opus' : 'aac', bitrate: 160e3 });
  output.addAudioTrack(src);
  const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(new MediaStream([track])).connect(an); // the level meter only: nothing is played out
  rec = { kind, stream, track, output, src, ctx, an, ext, type, label, began: performance.now(), pausedFor: 0, pausedAt: 0, stopping: false };
  let failed = null; src.errorPromise.catch(e => { failed = e; stop(); });
  try { await output.start(); } catch (e) { cleanup(); return api.toast(`Recording could not start: ${e.message || e}`, 8000); }
  track.addEventListener('ended', () => stop()); // the shared tab was closed, or "Stop sharing" was pressed in the browser's bar
  bar(true); tick();
  api.toast(kind === 'mic' ? 'Recording the microphone.' : 'Recording. Play the sound you want; press Stop when it is done.', 4000);
  rec.failed = () => failed;
}
function elapsed() { if (!rec) return 0; const now = rec.pausedAt || performance.now(); return (now - rec.began - rec.pausedFor) / 1000; }
function tick() {
  if (!rec) return; const b = $('#mxrecBar'); b.querySelector('.t').textContent = clock(elapsed());
  const d = new Float32Array(rec.an.fftSize); rec.an.getFloatTimeDomainData(d); let pk = 0; for (const v of d) pk = Math.max(pk, Math.abs(v));
  b.querySelector('.lv i').style.width = Math.min(100, Math.round(Math.sqrt(pk) * 100)) + '%';
  rec.raf = requestAnimationFrame(tick);
}
function pause() {
  if (!rec || typeof rec.src.pause !== 'function') return;
  if (rec.pausedAt) { rec.pausedFor += performance.now() - rec.pausedAt; rec.pausedAt = 0; rec.src.resume(); } else { rec.pausedAt = performance.now(); rec.src.pause(); }
  const b = $('#mxrecBar'); b.classList.toggle('paused', !!rec.pausedAt); b.querySelector('[data-a="pause"]').textContent = rec.pausedAt ? 'Resume' : 'Pause';
}
function cleanup() { if (!rec) return; cancelAnimationFrame(rec.raf); rec.stream.getTracks().forEach(t => t.stop()); rec.ctx.close().catch(() => {}); rec = null; bar(false); }
async function stop() {
  if (!rec || rec.stopping) return; const r = rec; r.stopping = true; const secs = elapsed();
  $('#mxrecBar').querySelector('[data-a="stop"]').textContent = 'Saving…';
  let file = null, err = r.failed && r.failed();
  try { if (r.pausedAt) r.src.resume(); await r.output.finalize(); if (!err) file = new File([r.output.target.buffer], `Recording ${stamp(new Date())}${r.ext}`, { type: r.type, lastModified: Date.now() }); }
  catch (e) { err = e; }
  cleanup();
  if (!file || secs < 0.5) return api.toast(err ? `The recording could not be saved: ${err.message || err}` : 'The recording was too short to keep.', 8000);
  window.__lastRecording = file;
  let len = secs; try { const inp = new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS }); const d = await inp.computeDuration(); if (isFinite(d) && d > 0) len = d; } catch (e) {} // its true length, read from the file (a browser can be unsure of a fresh recording's length)
  try { await api.add([file], { album: 'Recordings', title: file.name.replace(/\.[^.]+$/, ''), artist: r.label, duration: Math.round(len * 100) / 100 }); api.toast(`Saved to your library: “${file.name.replace(/\.[^.]+$/, '')}”, ${clock(secs)}.`, 6000); }
  catch (e) { api.toast(`The recording was made but could not be added to the library: ${e.message || e}`, 9000); }
}

function bar(on) {
  let b = $('#mxrecBar');
  if (!b) {
    b = document.createElement('div'); b.id = 'mxrecBar'; b.className = 'mxrec-bar'; b.setAttribute('role', 'status'); b.setAttribute('aria-label', 'Recording');
    b.innerHTML = '<span><span class="mxrec-dot"></span>REC</span><span class="t">0:00</span><span class="lv" aria-hidden="true"><i></i></span><span class="src"></span><button type="button" data-a="pause">Pause</button><button type="button" class="stop" data-a="stop">Stop</button>';
    b.addEventListener('click', e => { const a = e.target.closest('button'); if (!a) return; if (a.dataset.a === 'stop') stop(); else pause(); });
    document.body.append(b);
  }
  b.hidden = !on; b.classList.remove('paused'); b.querySelector('[data-a="stop"]').textContent = 'Stop'; b.querySelector('[data-a="pause"]').textContent = 'Pause';
  b.querySelector('[data-a="pause"]').hidden = !(rec && typeof rec.src.pause === 'function');
  if (on && rec) b.querySelector('.src').textContent = rec.label;
}

function sheet() {
  let s = $('#mxrecSheet');
  if (!s) {
    s = document.createElement('div'); s.id = 'mxrecSheet'; s.className = 'mxrec-sheet'; s.hidden = true;
    s.innerHTML = `<div class="mxrec-box" role="dialog" aria-modal="true" aria-labelledby="mxrecH"><h3 id="mxrecH">Record</h3><p>The recording goes into your library. It stays on this device. Record only what you have the right to record.</p>
      <div class="mxrec-src">${Object.entries(SOURCES).map(([k, v]) => `<button type="button" data-k="${k}"><b>${esc(v.title)}</b><small>${esc(v.sure)}. ${esc(v.how)}</small></button>`).join('')}</div>
      <div class="mxrec-acts"><button type="button" data-a="close">Close</button></div></div>`;
    s.addEventListener('click', e => { const b = e.target.closest('button'); if (e.target === s || (b && b.dataset.a === 'close')) return close(); if (b && b.dataset.k) { close(); start(b.dataset.k); } });
    s.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    document.body.append(s);
  }
  return s;
}
let back = null;
function open() { if (rec) return api.toast('Already recording: press Stop in the red bar first.', 4000); back = document.activeElement; const s = sheet(); s.hidden = false; s.querySelector('[data-k]').focus(); }
function close() { const s = $('#mxrecSheet'); if (s) s.hidden = true; if (back && back.focus) back.focus(); }

/* a = { after: the element the button goes after, add(files, meta), toast, cls } */
export function recorderButton(a) {
  api = a; if (!a.after || $('#recBtn')) return;
  const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
  const b = document.createElement('button'); b.type = 'button'; b.id = 'recBtn'; b.className = a.cls || 'btn'; b.title = 'Record the sound of a browser tab, the whole computer or the microphone, into your library';
  b.innerHTML = '<span class="mxrec-dot" aria-hidden="true"></span><span class="lbltxt">Record</span>';
  b.addEventListener('click', open); a.after.after(b);
  addEventListener('beforeunload', e => { if (rec) { e.preventDefault(); e.returnValue = ''; } }); // leaving would lose the recording
}
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__rec = { start, stop, pause, get rec() { return rec; } };
