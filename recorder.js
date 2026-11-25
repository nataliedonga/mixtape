/* Record, three ways:
     Screen          the picture of the screen, with the sound playing on this laptop (or without it). Saved as a video
                     file in Downloads.
     Laptop sound    only the sound: anything playing on this laptop (a website, a video, a call, an app).
                     Goes into the library.
     Microphone      your voice or the room. Goes into the library.

   For Screen and Laptop sound the browser shows its own window to choose what to share; it always does, a page cannot
   skip it. Choose "Entire screen" and keep "Also share system audio" ticked. It is written as it comes by mediabunny
   (MPL-2.0, already part of Mixtape), so each file knows its own length: sound as WebM/Opus (M4A/AAC where Opus cannot
   be written), the screen as MP4 (H.264 + AAC) or WebM where MP4 cannot be written. A screen recording is written to
   the browser's private folder as it goes (it can be large), then saved to Downloads. Nothing is sent anywhere.

   Record only what you have the right to record. */
import * as M from './vendor/mediabunny/mediabunny.min.mjs';
const $ = s => document.querySelector(s);
let api, rec = null;
const STYLE = `
.mxrec-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: #E5484D; margin-right: 6px; vertical-align: -1px; }
.mxrec-sheet { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; background: #0008; }
.mxrec-sheet[hidden] { display: none; }
.mxrec-box { width: min(420px, calc(100vw - 32px)); padding: 18px; border-radius: 16px; background: var(--surface, #1b1b22); color: var(--text, #eee); border: 1px solid var(--line, #fff2); box-shadow: 0 20px 60px #0008; font: 15px/1.45 var(--f-ui, system-ui, sans-serif); }
.mxrec-box h3 { margin: 0 0 12px; font-size: 18px; }
.mxrec-src { display: grid; gap: 8px; margin: 0 0 12px; }
.mxrec-src button { display: flex; align-items: center; gap: 12px; text-align: left; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line, #fff3); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.mxrec-src button:hover, .mxrec-src button:focus-visible { border-color: var(--accent, #c7a3ff); outline: none; }
.mxrec-src .ic { font-size: 22px; width: 28px; text-align: center; } .mxrec-src b { display: block; } .mxrec-src small { display: block; opacity: .7; font-size: 13px; }
.mxrec-opt { display: flex; align-items: center; gap: 8px; margin: -2px 0 10px 54px; font-size: 14px; opacity: .9; cursor: pointer; }
.mxrec-note { margin: 0 0 12px; font-size: 13px; opacity: .65; }
.mxrec-acts { display: flex; justify-content: flex-end; }
.mxrec-acts button { padding: 8px 14px; border-radius: 999px; border: 1px solid var(--line, #fff3); background: transparent; color: inherit; font: inherit; cursor: pointer; }
.mxrec-bar { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); z-index: 85; display: flex; align-items: center; gap: 12px; padding: 8px 10px 8px 14px; border-radius: 999px; background: #2a1517; color: #fff; border: 1px solid #E5484D88; box-shadow: 0 10px 30px #0007; font: 600 14px/1 var(--f-ui, system-ui, sans-serif); }
.mxrec-bar[hidden] { display: none; }
.mxrec-bar .t { font-variant-numeric: tabular-nums; min-width: 4.2em; }
.mxrec-bar .lv { width: 90px; height: 8px; border-radius: 4px; background: #ffffff22; overflow: hidden; } .mxrec-bar .lv i { display: block; height: 100%; width: 0; background: #7BD88F; transition: width .08s; }
.mxrec-bar button { padding: 7px 12px; border-radius: 999px; border: 1px solid #fff4; background: transparent; color: #fff; font: inherit; cursor: pointer; }
.mxrec-bar button.stop { background: #E5484D; border-color: #E5484D; }
.mxrec-bar .src { font-weight: 500; opacity: .8; }
.mxrec-bar.paused .mxrec-dot { background: #aaa; }
@media (prefers-reduced-motion: no-preference) { .mxrec-bar:not(.paused) .mxrec-dot { animation: mxrecblink 1.2s infinite; } }
@keyframes mxrecblink { 50% { opacity: .25; } }`;

const KINDS = {
  screen: { icon: '🖥', title: 'Screen', sub: 'Saved as a video in Downloads', bar: 'Screen' },
  sound: { icon: '🔊', title: 'Laptop sound', sub: 'Anything playing on this laptop · into your library', bar: 'Laptop sound' },
  mic: { icon: '🎙', title: 'Microphone', sub: 'Your voice · into your library', bar: 'Microphone' },
};
const clock = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60, p = n => String(n).padStart(2, '0'); return (h ? h + ':' + p(m) : m) + ':' + p(x); };
const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
const quiet = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };

async function streamFor(kind, withSound) {
  if (kind === 'mic') return navigator.mediaDevices.getUserMedia({ audio: quiet });
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('This browser cannot record the screen or the laptop’s sound. Use Chrome or Edge on a computer.');
  const s = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'monitor', frameRate: 30 }, audio: kind === 'sound' || withSound ? quiet : false, systemAudio: 'include', selfBrowserSurface: 'include', surfaceSwitching: 'include', monitorTypeSurfaces: 'include' });
  if ((kind === 'sound' || withSound) && !s.getAudioTracks().length) {
    if (kind === 'sound') { s.getTracks().forEach(t => t.stop()); throw new Error('No sound was shared. Try again: choose “Entire screen” and keep “Also share system audio” ticked.'); }
    api.toast('Recording the screen without sound: “Also share system audio” was not ticked.', 6000);
  }
  return s;
}

/* where a screen recording is written while it goes (the browser's private folder, so a long one is not held in memory) */
async function diskTarget(name) {
  const root = await navigator.storage.getDirectory(), dir = await root.getDirectoryHandle('recordings', { create: true });
  for await (const [n] of dir.entries()) { try { await dir.removeEntry(n); } catch (e) {} } // a recording left over from a page that was closed
  const fh = await dir.getFileHandle(name, { create: true }), ws = await fh.createWritable({ keepExistingData: false }); let done; const closed = new Promise(r => { done = r; });
  const target = new M.StreamTarget(new WritableStream({ write: async c => { await ws.write({ type: 'write', position: c.position, data: c.data }); }, close: async () => { await ws.close(); done(); }, abort: async () => { try { await ws.abort(); } catch (e) {} done(); } }), { chunked: true });
  return { target, file: async () => { await closed; return fh.getFile(); }, remove: async () => { try { await dir.removeEntry(name); } catch (e) {} } };
}

async function start(kind, withSound = true) {
  if (rec) return;
  let stream; try { stream = await streamFor(kind, withSound); } catch (e) { if (e.name === 'NotAllowedError' || e.name === 'AbortError') return api.toast(kind === 'mic' ? 'The microphone was not allowed, so nothing is recorded.' : 'Nothing was chosen, so nothing is recorded.', 4500); return api.toast(e.message || String(e), 8000); }
  const audio = stream.getAudioTracks()[0] || null, video = kind === 'screen' ? stream.getVideoTracks()[0] : null;
  if (kind === 'sound') stream.getVideoTracks().forEach(t => { t.enabled = false; }); // the picture is not kept (stopping it would end the sharing)
  const when = stamp(new Date());
  let output, target, disk = null, ext, type, src, vsrc = null;
  try {
    if (video) { // the screen: MP4 where it can be written, else WebM
      const avc = await M.canEncodeVideo('avc').catch(() => false), aac = await M.canEncodeAudio('aac').catch(() => false), mp4 = avc && (!audio || aac);
      ext = mp4 ? '.mp4' : '.webm'; type = mp4 ? 'video/mp4' : 'video/webm';
      disk = await diskTarget(`Screen recording ${when}${ext}`); target = disk.target;
      output = new M.Output({ format: mp4 ? new M.Mp4OutputFormat() : new M.WebMOutputFormat(), target });
      vsrc = new M.MediaStreamVideoTrackSource(video, { codec: mp4 ? 'avc' : 'vp9', bitrate: M.QUALITY_HIGH, latencyMode: 'realtime', sizeChangeBehavior: 'contain' });
      output.addVideoTrack(vsrc, { frameRate: 30 });
      if (audio) { src = new M.MediaStreamAudioTrackSource(audio, { codec: mp4 ? 'aac' : 'opus', bitrate: 160e3 }); output.addAudioTrack(src); }
    } else {
      const opus = await M.canEncodeAudio('opus').catch(() => false); ext = opus ? '.webm' : '.m4a'; type = opus ? 'audio/webm' : 'audio/mp4';
      target = new M.BufferTarget(); output = new M.Output({ format: opus ? new M.WebMOutputFormat() : new M.Mp4OutputFormat(), target });
      src = new M.MediaStreamAudioTrackSource(audio, { codec: opus ? 'opus' : 'aac', bitrate: 160e3 }); output.addAudioTrack(src);
    }
  } catch (e) { stream.getTracks().forEach(t => t.stop()); return api.toast(`Recording could not start: ${e.message || e}`, 8000); }
  let ctx = null, an = null; if (audio) { ctx = new AudioContext(); an = ctx.createAnalyser(); an.fftSize = 1024; ctx.createMediaStreamSource(new MediaStream([audio])).connect(an); } // the level meter only: nothing is played out
  rec = { kind, stream, output, target, disk, src, vsrc, ctx, an, ext, type, when, began: performance.now(), pausedFor: 0, pausedAt: 0, stopping: false, failed: null };
  for (const s of [src, vsrc]) if (s) s.errorPromise.catch(e => { if (rec) { rec.failed = e; stop(); } });
  try { await output.start(); } catch (e) { cleanup(); if (disk) disk.remove(); return api.toast(`Recording could not start: ${e.message || e}`, 8000); }
  for (const t of stream.getTracks()) t.addEventListener('ended', () => stop()); // "Stop sharing" in the browser's bar, or the shared screen went away
  bar(true); tick();
  api.toast(kind === 'screen' ? 'Recording the screen. Press Stop in the red bar when you are done.' : kind === 'sound' ? 'Recording the laptop’s sound. Play what you want; press Stop when it is done.' : 'Recording the microphone.', 4000);
}
function elapsed() { if (!rec) return 0; const now = rec.pausedAt || performance.now(); return (now - rec.began - rec.pausedFor) / 1000; }
function tick() {
  if (!rec) return; const b = $('#mxrecBar'); b.querySelector('.t').textContent = clock(elapsed());
  let pk = 0; if (rec.an) { const d = new Float32Array(rec.an.fftSize); rec.an.getFloatTimeDomainData(d); for (const v of d) pk = Math.max(pk, Math.abs(v)); }
  b.querySelector('.lv i').style.width = Math.min(100, Math.round(Math.sqrt(pk) * 100)) + '%';
  rec.raf = requestAnimationFrame(tick);
}
function pause() {
  if (!rec) return; const srcs = [rec.src, rec.vsrc].filter(Boolean); if (!srcs.every(s => typeof s.pause === 'function')) return;
  if (rec.pausedAt) { rec.pausedFor += performance.now() - rec.pausedAt; rec.pausedAt = 0; srcs.forEach(s => s.resume()); } else { rec.pausedAt = performance.now(); srcs.forEach(s => s.pause()); }
  const b = $('#mxrecBar'); b.classList.toggle('paused', !!rec.pausedAt); b.querySelector('[data-a="pause"]').textContent = rec.pausedAt ? 'Resume' : 'Pause';
}
function cleanup() { if (!rec) return; cancelAnimationFrame(rec.raf); rec.stream.getTracks().forEach(t => t.stop()); if (rec.ctx) rec.ctx.close().catch(() => {}); rec = null; bar(false); }
function download(file) { const a = document.createElement('a'), url = URL.createObjectURL(file); a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 120000); }
async function stop() {
  if (!rec || rec.stopping) return; const r = rec; r.stopping = true; const secs = elapsed();
  $('#mxrecBar').querySelector('[data-a="stop"]').textContent = 'Saving…';
  let file = null, err = r.failed;
  try {
    if (r.pausedAt) [r.src, r.vsrc].filter(Boolean).forEach(s => s.resume());
    await r.output.finalize();
    if (!err) { const name = `${r.kind === 'screen' ? 'Screen recording' : 'Recording'} ${r.when}${r.ext}`; file = r.disk ? new File([await r.disk.file()], name, { type: r.type, lastModified: Date.now() }) : new File([r.target.buffer], name, { type: r.type, lastModified: Date.now() }); }
  } catch (e) { err = e; }
  cleanup();
  if (!file || secs < 0.5) { if (r.disk) r.disk.remove(); return api.toast(err ? `The recording could not be saved: ${err.message || err}` : 'The recording was too short to keep.', 8000); }
  window.__lastRecording = file;
  if (r.kind === 'screen') { download(file); api.toast(`Saved to your Downloads: “${file.name}”, ${clock(secs)}.`, 7000); setTimeout(() => r.disk.remove(), 120000); return; } // the private copy goes once the download has had time to finish
  let len = secs; try { const d = await new M.Input({ source: new M.BlobSource(file), formats: M.ALL_FORMATS }).computeDuration(); if (isFinite(d) && d > 0) len = d; } catch (e) {} // its true length, read from the file
  try { await api.add([file], { album: 'Recordings', title: file.name.replace(/\.[^.]+$/, ''), artist: KINDS[r.kind].bar, duration: Math.round(len * 100) / 100 }); api.toast(`Saved to your library: “${file.name.replace(/\.[^.]+$/, '')}”, ${clock(secs)}.`, 6000); }
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
  if (on && rec) { b.querySelector('.src').textContent = KINDS[rec.kind].bar + (rec.kind === 'screen' && !rec.src ? ' (no sound)' : ''); b.querySelector('.lv').hidden = !rec.an; }
}

function sheet() {
  let s = $('#mxrecSheet');
  if (!s) {
    s = document.createElement('div'); s.id = 'mxrecSheet'; s.className = 'mxrec-sheet'; s.hidden = true;
    s.innerHTML = `<div class="mxrec-box" role="dialog" aria-modal="true" aria-labelledby="mxrecH"><h3 id="mxrecH">Record</h3>
      <div class="mxrec-src">${Object.entries(KINDS).map(([k, v]) => `<button type="button" data-k="${k}"><span class="ic" aria-hidden="true">${v.icon}</span><span><b>${v.title}</b><small>${v.sub}</small></span></button>${k === 'screen' ? '<label class="mxrec-opt"><input type="checkbox" id="mxrecWithSound" checked> With sound</label>' : ''}`).join('')}</div>
      <p class="mxrec-note">For Screen and Laptop sound, the browser asks what to share: choose “Entire screen” and keep “Also share system audio” ticked.</p>
      <div class="mxrec-acts"><button type="button" data-a="close">Close</button></div></div>`;
    s.addEventListener('click', e => { const b = e.target.closest('button'); if (e.target === s || (b && b.dataset.a === 'close')) return close(); if (b && b.dataset.k) { const ws = $('#mxrecWithSound').checked; close(); start(b.dataset.k, ws); } });
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
  const b = document.createElement('button'); b.type = 'button'; b.id = 'recBtn'; b.className = a.cls || 'btn'; b.title = 'Record the screen, the laptop’s sound or the microphone';
  b.innerHTML = '<span class="mxrec-dot" aria-hidden="true"></span><span class="lbltxt">Record</span>';
  b.addEventListener('click', open); a.after.after(b);
  addEventListener('beforeunload', e => { if (rec) { e.preventDefault(); e.returnValue = ''; } }); // leaving would lose the recording
}
if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__rec = { start, stop, pause, get rec() { return rec; } };
