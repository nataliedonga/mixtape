/* Two recognisers to choose between, per the licence of each:

   Paid or client work  Mixtape's own recogniser (Whisper, MIT): free for any use, runs in this page.
   Personal             Rev's Reverb: better on speech like court audio, but Rev's licence allows personal, testing and
                        research use only, and it cannot run in a browser. It runs in a small helper on this computer
                        (the "reverb-personal" folder: Start Reverb for Mixtape.cmd).

   Mixtape and the helper never talk over any network. They share one folder that you choose once (the helper's
   "inbox"): this page writes the recording there as plain sound plus a small job note; the helper writes the words
   back; this page reads them and removes the files. See watch.py in that folder for the other half. */
const KEY = 'mixtape-transcript-engine', $ = s => document.querySelector(s);
let api, dir = null, home = '', lastStatus = null, statusT = 0;

/* ---- the chosen folder is remembered on this device ---- */
const db = () => new Promise((res, rej) => { const r = indexedDB.open('mixtape-reverb', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const kv = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); }); };
const allowed = async ask => { if (!dir) return false; const o = { mode: 'readwrite' }; try { if ((await dir.queryPermission(o)) !== 'granted' && !(ask && (await dir.requestPermission(o)) === 'granted')) return false; await inbox(); return true; } catch (e) { return false; } };
// The helper watches the folder named "inbox" inside reverb-personal. Choosing reverb-personal itself is the natural
// thing to do, so that works too: its inbox is found (or made) and used.
async function inbox() { if (!dir || dir.name === 'inbox') return; try { const sub = await dir.getDirectoryHandle('inbox', { create: true }); home = dir.name; dir = sub; kv('readwrite', s => s.put(sub, 'inbox')).catch(() => {}); } catch (e) {} }
const readJSON = async name => { try { const f = await (await dir.getFileHandle(name)).getFile(); return JSON.parse(await f.text()); } catch (e) { return null; } };
const drop = async name => { try { await dir.removeEntry(name); } catch (e) {} };

export const reverbChosen = () => { try { return localStorage.getItem(KEY) === 'personal' && 'showDirectoryPicker' in window; } catch (e) { return false; } };

/* ---- the choice, drawn into the "Write down what is said" card ---- */
function draw() {
  const box = $('#engineBox'); if (!box) return; const can = 'showDirectoryPicker' in window, personal = reverbChosen();
  box.querySelector('#engPaid').checked = !personal; box.querySelector('#engPersonal').checked = personal; box.querySelector('#engPersonal').disabled = !can;
  const s = box.querySelector('#engStatus'), pick = box.querySelector('#engPick'); s.hidden = pick.hidden = !personal;
  const pr = box.querySelector('#engPunctRow'); if (pr) { pr.hidden = !(personal && canPunct()); box.querySelector('#engPunct').checked = wantPunct(); }
  punctRow();
  if (!can) { box.querySelector('#engNo').hidden = false; return; }
  if (!personal) return;
  pick.textContent = dir ? `Folder: “${home ? home + ' › ' : ''}${dir.name}” (change)` : 'Choose the Reverb folder…';
  const st = lastStatus, alive = st && st.alive && Date.now() / 1000 - st.alive < 6;
  s.className = 'engstatus' + (alive && st.state !== 'loading' ? ' ok' : '');
  s.textContent = !dir ? 'Once only: choose your reverb-personal folder.'
    : !st && lastStatus === null ? 'Looking for Reverb on this computer…'
    : !alive ? 'Reverb’s helper is not running. In your reverb-personal folder, double-click “Start Reverb with Windows” (once: after that it is always ready), or “Start Reverb for Mixtape” for just this time.'
    : st.state === 'loading' ? 'Reverb is starting on this computer (a minute or two)…'
    : st.state === 'working' ? `Reverb is busy with “${st.name || 'another recording'}”; yours will wait its turn.`
    : 'Reverb is ready on this computer. Press Transcribe.';
}
async function refresh() { if (!reverbChosen() || !dir || document.hidden || !(await allowed(false))) return draw(); lastStatus = (await readJSON('status.json')) || false; draw(); }
function build() {
  const go = $('#goHeard'); if (!go || $('#engineBox')) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'reverb.css'; document.head.appendChild(link);
  const f = document.createElement('fieldset'); f.id = 'engineBox'; f.className = 'engine';
  f.innerHTML = `<legend>What is this transcript for?</legend>
    <label class="eng"><input type="radio" name="engine" id="engPaid" value="paid"><span><b>Paid or client work</b><small>Mixtape’s own recogniser (Whisper). Free for any use. Runs in this page.</small></span></label>
    <label class="eng"><input type="radio" name="engine" id="engPersonal" value="personal"><span><b>Personal</b><small>Rev’s Reverb: better on speech like court audio. Rev’s licence allows personal use only, never paid or client work. Runs in a helper on this computer.</small></span></label>
    <p class="engstatus" id="engNo" hidden>Personal needs Chrome or Edge on a computer; this browser cannot share a folder with the helper.</p>
    <p class="engstatus" id="engStatus" role="status" hidden></p>
    <button type="button" class="btn sm" id="engPick" hidden></button>
    <label class="eng engsub" id="engPunctRow" hidden><input type="checkbox" id="engPunct"><span><b>Add punctuation and capitals afterwards</b><small>By a small language model in the helper, on this computer. Takes about as long as the recording again. No word is changed.</small></span></label>`;
  go.parentNode.insertBefore(f, go);
  f.addEventListener('change', e => { if (e.target.id === 'engPunct') { try { localStorage.setItem(PKEY, e.target.checked ? '1' : '0'); } catch (err) {} return; } if (e.target.name !== 'engine') return; try { localStorage.setItem(KEY, e.target.value); } catch (err) {} lastStatus = null; draw(); refresh(); });
  f.querySelector('#engPick').addEventListener('click', async () => {
    try { const d = await showDirectoryPicker({ id: 'reverb-inbox', mode: 'readwrite' }); dir = d; home = ''; await kv('readwrite', s => s.put(d, 'inbox')).catch(() => {}); await inbox(); lastStatus = null; await refresh(); }
    catch (e) { if (e.name !== 'AbortError') api.toast('That folder could not be opened. Choose your reverb-personal folder.', 6000); }
  });
  draw(); clearInterval(statusT); statusT = setInterval(refresh, 2500); refresh();
}

/* ---- the sound, written into the folder as a 16 kHz mono WAV, a window at a time (hours never sit in memory) ---- */
/* Who is speaking when, for a Reverb transcript. Reverb only hears the words; the voices are found here, in the browser,
   by the same speaker finder the in-browser recogniser uses (speaker-worker.js), 30 seconds at a time. Each word takes
   the speaker of the turn it falls in, and a new speaker starts a new paragraph. Nothing leaves this computer. */
async function addSpeakers(track, words, from, dur, tick, job) {
  const T = window.TranscriptCore, voices = []; let out = [], k = 0, failed = 0;
  if (!T || words.some(x => x.s == null)) return null;
  const heard = words.map(x => ({ text: x.t, start: x.s, end: x.e ?? x.s, ...(x.c != null ? { c: x.c } : {}) }));
  const w = new Worker('../speaker-worker.js', { type: 'module' });
  const ask = msg => new Promise(res => { w.onmessage = m => { const x = m.data; if (x.type === 'speakers') res(x); else if (x.type === 'error') { console.warn('speakers:', x.message); res(null); } }; w.onerror = e => { console.warn('speakers:', e.message); res(null); }; w.postMessage(msg, [msg.audio.buffer]); });
  try {
    for (let w0 = Math.max(0, from - 2.5); w0 < dur; w0 += 25) {
      if (job && job.stop) throw Object.assign(new Error('stopped'), { stopped: true });
      const w1 = Math.min(dur, w0 + 30), keepFrom = w0 <= from ? from : w0 + 2.5, keepTo = w1 >= dur ? Infinity : w0 + 27.5;
      let part = []; while (k < heard.length && heard[k].start < keepTo) part.push(heard[k++]);
      if (part.length) {
        const pcm = await api.window16k(track, w0, w1), sp = pcm.length > 8000 ? await ask({ audio: pcm, offset: w0, keepFrom: keepFrom === 0 ? -1 : keepFrom, keepTo }) : null;
        if (sp && sp.turns.length) { const names = sp.prints.map(pr => T.clusterVoice(voices, pr).name); part = T.labelHeard(part, sp.turns.map(t => ({ s: t.s, e: t.e, name: t.g >= 0 ? names[t.g] : null }))); }
        else if (!sp) failed++;
      }
      out = T.append(out, part); if (tick) tick(Math.min(1, w1 / dur));
      if (w1 >= dur) break;
    }
  } finally { w.terminate(); }
  return failed && !voices.length ? null : { words: out, voices };
}
/* ---- punctuation and capitals, by the helper's language model ----
   Reverb gives lower-case words with no marks. The helper can add them (punctuate.py beside watch.py): this page hands
   over the words, one list per speaker turn, and gets the same words back with marks and capitals. Nothing is taken on
   trust: a word comes back into the transcript only if its letters are exactly the ones that were heard, so the model
   can add a full stop or a capital and nothing else. Legal notations are not sent. Ctrl + Z undoes the whole step. */
const PKEY = 'mixtape-reverb-punct', pkey = x => String(x).toLowerCase().replace(/[^a-z0-9']/g, '');
const wantPunct = () => { try { return localStorage.getItem(PKEY) !== '0'; } catch (e) { return true; } };
const canPunct = () => !!(dir && lastStatus && lastStatus.punct && lastStatus.alive && Date.now() / 1000 - lastStatus.alive < 8);
const bare = words => { let n = 0, m = 0; for (const w of words) { if (w.lg) continue; n++; if (/[.?!,]$/.test(w.t) || /^[A-Z]/.test(w.t)) m++; } return n > 20 && m / n < 0.03; }; // hardly a mark or a capital in it
function speechTurns(words) { // [[word numbers]]: one list per speaker turn, without notations
  const out = []; let cur = null, sp = '', skip = 0, note = false;
  words.forEach((w, i) => {
    if (i === 0 || w.p) { note = !!(w.lg && w.lg.k === 'n'); if (note) { cur = null; return; } const who = w.sp || sp; if (!cur || who !== sp) { cur = []; out.push(cur); } sp = who; }
    if (note) return;
    if (w.lg && w.lg.len) skip = w.lg.len; if (skip > 0) { skip--; return; }
    if (cur) cur.push(i);
  });
  return out.filter(t => t.length);
}
async function punctCore(cur, job, st, bar) {
  const r = cur.tr, id = String(cur.track.id).replace(/[^\w-]/g, '_'), jobF = id + '.punctjob.json', outF = id + '.punct.json', errF = id + '.puncterr.json';
  const turns = speechTurns(r.words), n = turns.reduce((a, t) => a + t.length, 0); if (!n) return 0;
  const clean = async () => { for (const f of [jobF, outF, errF]) await drop(f); };
  try {
    await clean(); bar.style.width = '0%'; st.textContent = 'Adding punctuation on this computer: starting the language model…';
    const jw = await (await dir.getFileHandle(jobF, { create: true })).createWritable(); await jw.write(JSON.stringify({ turns: turns.map(t => t.map(i => r.words[i].t)), name: cur.track.title || '' })); await jw.close();
    let quiet = 0;
    for (;;) {
      await new Promise(res => setTimeout(res, 1500));
      if (job.stop) throw Object.assign(new Error('stopped'), { stopped: true });
      const bad = await readJSON(errF); if (bad) throw new Error(bad.error || 'no reason given');
      const got = await readJSON(outF);
      if (got && Array.isArray(got.turns)) {
        api.remember(); let marked = 0; const words = r.words.slice();
        got.turns.forEach((t, k) => { const ix = turns[k]; if (!ix || !Array.isArray(t) || t.length !== ix.length) return; t.forEach((neu, j) => { const w = words[ix[j]]; neu = String(neu); if (neu !== w.t && pkey(neu) && pkey(neu) === pkey(w.t)) { words[ix[j]] = { ...w, t: neu }; marked++; } }); });
        r.words = words; r.punct = { at: Date.now(), by: String(got.engine || 'the helper’s language model'), marked };
        await api.save(); return marked;
      }
      const s = await readJSON('status.json'), alive = s && s.alive && Date.now() / 1000 - s.alive < 8; quiet = alive ? 0 : quiet + 1;
      if (quiet > 8) throw new Error('the helper stopped answering');
      const mine = alive && s.file === id;
      st.textContent = mine ? `Adding punctuation on this computer: ${s.note || 'working'} · about as long as the recording` : alive ? `Waiting for the helper to finish “${s.name || 'another recording'}”…` : 'Waiting for the helper to answer…';
      bar.style.width = Math.round((mine ? (s.progress || 0) : 0) * 100) + '%';
    }
  } finally { await clean(); }
}
/* the button: for a transcript that is already there */
async function punctuateNow() {
  const cur = api.cur; if (!cur || !cur.tr || !cur.tr.done) return; if (api.job) return api.toast('Wait for what is running to finish first.', 4000);
  if (!dir || !(await allowed(true))) return api.toast('Choose your reverb-personal folder first (under Personal, in “Write down what is said”).', 7000);
  lastStatus = (await readJSON('status.json')) || false;
  if (!canPunct()) return api.toast(lastStatus && lastStatus.alive && Date.now() / 1000 - lastStatus.alive < 8 ? 'The helper that is running is an older one and cannot add punctuation. Close it and start it again from your reverb-personal folder.' : 'Reverb’s helper is not running. Start it from your reverb-personal folder, then press the button again.', 9000);
  const job = { stop: false }; api.setJob(job); $('#run').hidden = false;
  try { const n = await punctCore(cur, job, $('#runSt'), $('#runBar')); api.toast(`Punctuation and capitals added to ${n.toLocaleString()} words, on this computer. No word was changed. Ctrl + Z undoes it.`, 8000); }
  catch (e) { if (e.stopped) api.toast('Stopped. The transcript is as it was.', 4000); else { api.toast(`Punctuation could not be added (${e.message || e}). The transcript is as it was.`, 9000); console.error(e); } }
  finally { api.setJob(null); $('#run').hidden = true; api.drawAll(); }
}
function punctRow() {
  let row = $('#punctRow'); const t = $('#text'); if (!t) return;
  if (!row) { row = document.createElement('section'); row.id = 'punctRow'; row.hidden = true; t.before(row); row.addEventListener('click', e => { if (e.target.closest('button')) punctuateNow(); }); }
  const cur = api.cur, r = cur && cur.tr, show = !!(r && r.done && r.mode === 'heard' && !r.punct && !api.job && reverbChosen() && canPunct() && bare(r.words));
  if (show === !row.hidden) return; row.hidden = !show;
  if (show) row.innerHTML = '<span>This transcript has no punctuation or capitals.</span><button type="button" class="btn sm">Add them on this computer</button><small>Takes about as long as the recording. No word is changed, and nothing leaves the computer.</small>';
}
async function writeWav(name, track, t0, dur, tick) { // from t0 to dur: the whole recording, or only the part asked for
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable(); let frames = 0;
  const head = n => { const b = new ArrayBuffer(44), v = new DataView(b), S = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0))); S(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); S(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); S(36, 'data'); v.setUint32(40, n * 2, true); return b; };
  try {
    await w.write(head(0));
    for (let t = t0; t < dur; t += 30) {
      if (api.job.stop) throw Object.assign(new Error('stopped'), { stopped: true });
      const pcm = await api.window16k(track, t, Math.min(dur, t + 30)), out = new Int16Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) { const x = Math.max(-1, Math.min(1, pcm[i])); out[i] = x < 0 ? x * 32768 : x * 32767; }
      await w.write(out.buffer); frames += out.length; tick(Math.min(1, (t + 30 - t0) / (dur - t0)));
    }
    await w.write({ type: 'write', position: 0, data: head(frames) }); await w.close();
  } catch (e) { try { await w.abort(); } catch (err) {} await drop(name); throw e; }
}

/* ---- Transcribe, the Personal way ---- */
export async function startReverb() {
  const cur = api.cur; if (!cur || api.job) return;
  if (!dir) return api.toast('Choose the Reverb folder first (the button under “Personal”).', 6000);
  if (!(await allowed(true))) return api.toast('Mixtape needs your permission to use the Reverb folder. Press Transcribe again and allow it.', 7000);
  const st0 = await readJSON('status.json');
  if (!st0 || !st0.alive || Date.now() / 1000 - st0.alive > 8) return api.toast('Reverb’s helper is not running. In your reverb-personal folder, double-click “Start Reverb with Windows” (once: after that it is always ready), or “Start Reverb for Mixtape” for just this time. Then press Transcribe again.', 12000);
  const id = String(cur.track.id).replace(/[^\w-]/g, '_'), wav = id + '.wav', jobF = id + '.job.json', outF = id + '.reverb.json', errF = id + '.error.json';
  const pt = api.partChosen ? api.partChosen(cur) : null; if (pt === false) return; // only a part was asked for, and what was typed cannot be used
  const job = { stop: false }; api.setJob(job); const st = $('#runSt'), bar = $('#runBar');
  $('#start').hidden = true; $('#cont').hidden = true; $('#run').hidden = false; bar.style.width = '0%';
  const clean = async () => { for (const n of [jobF, wav, outF, errF]) await drop(n); };
  try {
    await clean();
    const input = new api.M.Input({ source: new api.M.BlobSource(cur.blob), formats: api.M.ALL_FORMATS }), a = await input.getPrimaryAudioTrack(); if (!a) throw new Error('this file has no sound');
    if (!(await a.canDecode())) throw new Error(`this browser cannot decode its sound (${a.codec})`);
    const cut = pt && !pt.whole ? pt : null; /* pt.whole: the whole recording is written down and only the part is shown */
    const whole = await a.computeDuration(), t0 = cut ? cut.a : 0, dur = cut ? Math.min(whole, cut.b) : whole;
    st.textContent = 'Handing the recording to Reverb on this computer…';
    await writeWav(wav, a, t0, dur, p => { bar.style.width = Math.round(p * 10) + '%'; });
    const jw = await (await dir.getFileHandle(jobF, { create: true })).createWritable(); await jw.write(JSON.stringify({ audio: wav, name: cur.track.title || '', verbatim: 1 })); await jw.close();
    let quiet = 0;
    for (;;) {
      await new Promise(r => setTimeout(r, 1500));
      if (job.stop) throw Object.assign(new Error('stopped'), { stopped: true });
      const bad = await readJSON(errF); if (bad) throw new Error(`Reverb could not do it (${bad.error || 'no reason given'})`);
      const got = await readJSON(outF);
      if (got && Array.isArray(got.words)) {
        const num = v => { const n = +v; return v == null || !isFinite(n) ? null : n; };
        const at = v => { const n = num(v); return n == null ? null : Math.round((n + t0) * 1000) / 1000; }; /* Reverb heard only the part: its times start at the part's start */
        const words = got.words.map(w => ({ t: String(w.t), s: at(w.s), e: at(w.e), ...(w.p ? { p: true } : {}), ...(w.c != null && isFinite(+w.c) ? { c: +w.c } : {}) })); if (words[0]) words[0].p = true;
        if (!words.length) throw new Error('Reverb heard no words in this recording');
        // the words are kept at once (so they are safe), then the voices are found and the speakers put on them
        cur.tr = { id: cur.track.id, mode: 'heard', words, upTo: dur, done: true, duration: whole, updated: Date.now(), speakers: false, engine: 'Reverb ASR v1 (Rev)', use: 'personal', ...(pt ? { part: pt } : {}) };
        await api.save(); let who = null;
        try { st.textContent = 'Finding who speaks when, on this computer…'; bar.style.width = '0%'; who = await addSpeakers(a, words, t0, dur, p => { bar.style.width = Math.round(p * 100) + '%'; st.textContent = `Finding who speaks when, on this computer: ${Math.round(p * 100)}%`; }, job); }
        catch (e) { if (e && e.stopped) who = null; else console.warn('speakers:', e); }
        if (who && who.words.length === words.length) { cur.tr.words = who.words; cur.tr.voices = who.voices; cur.tr.speakers = true; }
        if (api.partTrim) api.partTrim(cur.tr); // what the website leaves out is not kept
        await api.save(); await clean();
        let marks = -1; lastStatus = (await readJSON('status.json')) || lastStatus;
        if (wantPunct() && canPunct()) { try { marks = await punctCore(cur, job, st, bar); } catch (e) { if (!e.stopped) { console.warn('punctuation:', e); api.toast(`The words are ready, but punctuation could not be added (${e.message || e}). You can add it later from the transcript.`, 9000); } } }
        api.toast(`Transcript ready: ${words.length.toLocaleString()} words by Reverb${who && cur.tr.speakers ? `, ${who.voices.length} speaker${who.voices.length === 1 ? '' : 's'} found (click a name to rename it everywhere)` : ', without speakers (they could not be found this time)'}${marks > 0 ? ', punctuation and capitals added' : ''}. Personal use only.`, 9000); return;
      }
      const s = await readJSON('status.json'), alive = s && s.alive && Date.now() / 1000 - s.alive < 8; quiet = alive ? 0 : quiet + 1;
      if (quiet > 8) throw new Error('Reverb’s helper stopped answering. Start it again from your reverb-personal folder, then press Transcribe');
      const mine = alive && s.file === id;
      st.textContent = !alive ? 'Waiting for Reverb to answer…' : s.state === 'loading' ? 'Reverb is waking up on this computer (a minute or two the first time)…' : mine ? `Reverb is writing it down on this computer: ${Math.round((s.progress || 0) * 100)}%` : `Waiting for Reverb to finish “${s.name || 'another recording'}”…`;
      bar.style.width = Math.round(10 + (mine ? (s.progress || 0) : 0) * 90) + '%';
    }
  } catch (e) {
    await clean();
    if (e.stopped) api.toast('Stopped. Nothing was kept from Reverb.', 4000); else { api.toast(`Stopped: ${e.message || e}.`, 9000); console.error(e); }
  } finally { api.setJob(null); $('#run').hidden = true; api.drawAll(); }
}

/* ---- a transcript made by Reverb says so, wherever its details are shown ---- */
function badge() {
  const m = $('#meta'), cur = api.cur; if (!m || !cur || !cur.tr || cur.tr.use !== 'personal') return;
  if (!m.textContent.includes('personal use only')) m.textContent += ' · by Reverb, personal use only';
}

export function initReverb(a) {
  api = a; build();
  const m = $('#meta'); if (m) new MutationObserver(badge).observe(m, { childList: true, characterData: true, subtree: true });
  kv('readonly', s => s.get('inbox')).then(d => { if (d) { dir = d; refresh(); } }).catch(() => {});
  if (['localhost', '127.0.0.1'].includes(location.hostname)) window.__reverb = { setDir(d) { dir = d; lastStatus = null; return refresh(); }, startReverb, reverbChosen, punctuateNow, speechTurns, async speakersFor(words) { const cur = api.cur, input = new api.M.Input({ source: new api.M.BlobSource(cur.blob), formats: api.M.ALL_FORMATS }), a = await input.getPrimaryAudioTrack(); return addSpeakers(a, words, 0, await a.computeDuration(), null, null); } }; // for checks on this computer only
}
