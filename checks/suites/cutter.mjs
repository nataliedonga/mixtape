// Cutter: an exact cut is exact, a join is as long as its clips, sound the browser cannot decode is refused on an
// exact cut with a plain message, and the untouched copy of it works.
import { RETURNING, WAV_INFO, DECODED_SECONDS } from '../lib/inpage.mjs';

export const needsBrowser = true;

// what the Cutter would have written to Downloads is kept in the page instead (the Cutter's own hook for tests)
const CAPTURE = `(window.__saved = [], window.__cutterSave = (file, name) => { window.__saved.push({ file, name }); return { where: 'the check', name, folder: false }; }, true)`;
const setSelect = (sel, v) => `(() => { const s = document.querySelector(${JSON.stringify(sel)}); if (![...s.options].some(o => o.value === ${JSON.stringify(v)})) return false; s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); s.blur(); return true; })()`;
const row = `(() => { const r = [...document.querySelectorAll('#sheet .jobrow')].pop(); return r ? { done: r.classList.contains('done'), fail: r.classList.contains('fail'), text: r.querySelector('.st').textContent } : null; })()`;

export async function run(t) {
  const page = await t.open('/cutter/', { preload: RETURNING });
  await page.waitFor('window.__cutter', 15000, 'the Cutter to start');
  await page.eval(CAPTURE);
  const finished = async what => { await page.waitFor(`(() => { const r = ${row}; return r && (r.done || r.fail); })()`, 40000, what); return page.eval(row); };
  const closeSheet = async () => { if (await page.eval(`!document.querySelector('#sheet').hidden`)) await page.click('#exCancel'); await page.waitFor(`document.querySelector('#sheet').hidden`, 5000, 'the export sheet to close'); };

  // ---- 1. open a clip ----
  await page.setFiles('#fileIn', [t.media.get('clip.wav')]);
  await page.waitFor(`__cutter.files.length === 1 && __cutter.files[0].state !== 'opening'`, 20000, 'the clip to open');
  const opened = await page.eval(`(() => { const f = __cutter.files[0]; return { state: f.state, seconds: f.media && f.media.duration, error: f.error || null, shown: document.querySelector('#fileList').textContent.includes('clip.wav') }; })()`);
  t.check('a clip opens', 'the 5 s clip is open, listed, and 5.000 s long (±5 ms)', opened.state === 'ok' && opened.shown && Math.abs(opened.seconds - 5) < 0.005, opened);

  // ---- 2. mark 1 s to 3 s with the keys, export exact to WAV ----
  await page.eval(setSelect('#skipSel', '1')); // the arrow keys move one second
  await page.press('Home'); await page.press('ArrowRight'); await page.press('i');
  await page.press('ArrowRight'); await page.press('ArrowRight'); await page.press('o');
  const parts = await page.eval(`__cutter.cur.parts.map(p => [p.t0, p.t1])`);
  t.check('keys mark a part', 'Home, →, I, →, →, O (one-second steps) mark one part from 1 s to 3 s', parts.length === 1 && Math.abs(parts[0][0] - 1) < 1e-6 && Math.abs(parts[0][1] - 3) < 1e-6, parts);
  await page.waitFor(`[...document.querySelector('#fmtSel').options].some(o => o.value === 'wav')`, 8000, 'WAV to be offered in the Format list').catch(() => {});
  const wavOk = await page.eval(setSelect('#fmtSel', 'wav'));
  await page.eval(`document.querySelector('#segPrec [data-v="exact"]').classList.contains('on')`) || await page.click('#segPrec [data-v="exact"]');
  await page.click('#exportBtn');
  let r = await finished('the exact cut to be written');
  const cut = await page.eval(`(async () => { const s = __saved[__saved.length - 1]; return s ? { name: s.name, ...(await (${WAV_INFO})(s.file)) } : null; })()`);
  t.check('exact cut to WAV', 'the part from 1 s to 3 s comes out as a WAV 2.000 s long, within 5 ms, and not silent', wavOk && r.done && cut && !cut.error && Math.abs(cut.seconds - 2) <= 0.005 && cut.peak > 0.05, cut ? { ...cut, off_ms: +((cut.seconds - 2) * 1000).toFixed(3), wavOffered: wavOk } : r);
  await closeSheet();

  // ---- 3. join three clips of different formats ----
  await page.setFiles('#fileIn', [t.media.get('join-1.wav'), t.media.get('join-2.mp3'), t.media.get('join-3.m4a')]);
  await page.waitFor(`__cutter.files.length === 4 && __cutter.files.every(f => f.state !== 'opening')`, 30000, 'the three clips to open');
  const clips = await page.eval(`__cutter.files.slice(1).map(f => ({ name: f.media.file.name, state: f.state, seconds: f.media && f.media.duration, codec: f.media && f.media.audio && f.media.audio.codec, error: f.error || null }))`);
  const sum = clips.reduce((s, c) => s + (c.seconds || 0), 0);
  t.check('three formats open', 'a WAV, an MP3 and an M4A open, each within 60 ms of the length it was made with', clips.length === 3 && clips.every(c => c.state === 'ok' && Math.abs(c.seconds - t.media.seconds(c.name)) < 0.06) && new Set(clips.map(c => c.codec)).size === 3, clips.map(c => `${c.name} ${c.state} ${c.seconds && c.seconds.toFixed(3)} s ${c.codec || c.error}`));
  await page.eval(`(__saved.length = 0, true)`);
  const fmtNow = await page.eval(`__cutter.S.fmt`);
  await page.click('#joinBtn');
  await page.waitFor(`document.querySelectorAll('#sheet #jl .joinrow').length === 4`, 5000, 'the join list');
  await page.click('#sheet #jl [data-c="0"]'); // leave the first clip (clip.wav) out
  const jsum = await page.eval(`document.querySelector('#jSum').textContent`);
  await page.click('#jGo');
  r = await finished('the joined file to be written');
  const joined = await page.eval(`(async () => { const s = __saved.find(x => /\\.wav$/i.test(x.name)); return { names: __saved.map(x => x.name), ...(s ? await (${WAV_INFO})(s.file) : { error: 'no WAV was written' }), list: window.__lastClipList || null }; })()`);
  t.check('join three formats', 'with the format still on WAV, the joined WAV is as long as the three clips together (within 5 ms of the lengths the Cutter shows) and not silent', fmtNow === 'wav' && r.done && !joined.error && Math.abs(joined.seconds - sum) <= 0.005 && joined.peak > 0.05, { format: fmtNow, joined_s: joined.seconds, clips_s: +sum.toFixed(4), off_ms: joined.seconds != null ? +((joined.seconds - sum) * 1000).toFixed(3) : null, peak: joined.peak, sheet: jsum, error: joined.error || (r.fail ? r.text : undefined) });
  t.check('clip list', 'a clip list is saved beside the joined file, naming the three clips', joined.names.some(n => /clip list/.test(n)) && joined.list && ['join-1.wav', 'join-2.mp3', 'join-3.m4a'].every(n => joined.list.includes(n)), joined.names);
  await page.eval(`(() => { const s = __saved.find(x => /\\.wav$/i.test(x.name)); window.__joinedKeep = s ? new File([s.file], s.name, { type: 'audio/wav' }) : null; return true; })()`);
  // ---- Transcribe it: from the finished file straight into Transcripts, with Personal or not chosen here ----
  await page.eval(`(window.__opened = [], window.__cutterGo = u => { window.__opened.push(String(u)); }, true)`); // leaving the Cutter is stood in for (the check goes on using it); the address it would go to is opened below for real
  await page.click('#sheet .jobrow:last-of-type [data-tr]');
  await page.waitFor(`window.__lastTranscribe && window.__opened.length === 1`, 15000, 'the file to be sent to Transcripts');
  const sent = await page.eval(`({ ...window.__lastTranscribe, opened: window.__opened[0], lib: (document.querySelector('#sheet .jobrow:last-of-type [data-lib]') || {}).textContent })`);
  const trPage = await t.open('/transcribe/' + sent.opened.slice(sent.opened.indexOf('?')), { site: { origin: page.origin }, preload: RETURNING });
  const there = await trPage.waitFor(`window.__tr && __tr.cur && __tr.cur.media.readyState >= 1 ? { name: __tr.cur.track.name, seconds: +__tr.cur.media.duration.toFixed(2), choice: !!document.querySelector('#engPaid') && !!document.querySelector('#engPersonal'), start: !!document.querySelector('#goHeard'), job: !!__tr.job } : null`, 20000, 'Transcripts to open the joined file').catch(e => ({ error: e.message }));
  t.check('Transcribe it', 'after a join, one real click on “Transcribe it” puts the file in the library and goes to Transcripts on that file (same name, same length), where Paid or Personal is chosen and Transcribe pressed; nothing starts by itself',
    /transcribe\/\?song=[^&]+$/.test(sent.opened) && there && there.name === joined.names.find(n => /\.wav$/i.test(n)) && Math.abs(there.seconds - sum) < 0.05 && there.choice && there.start && !there.job, { sent, there });
  await trPage.close();
  await closeSheet();

  // ---- 4. AC-3 sound: refused on an exact cut, copied by an untouched one ----
  await page.setFiles('#fileIn', [t.media.get('ac3-sound.mkv')]);
  await page.waitFor(`__cutter.files.length === 5 && __cutter.files[4].state !== 'opening'`, 30000, 'the AC-3 file to open');
  await page.eval(`(() => { const f = __cutter.files[4]; if (f.state === 'ok' && __cutter.cur !== f) document.querySelectorAll('#fileList > *')[4].click(); return true; })()`);
  const ac3 = await page.waitFor(`(() => { const f = __cutter.files[4]; return f.state !== 'ok' || __cutter.cur === f ? { state: f.state, error: f.error || null, picture: !!(f.media && f.media.v), sound: f.media && f.media.audio && f.media.audio.codec, canDecode: f.media && f.media.audio && f.media.audio.canDecode, seconds: f.media && f.media.duration } : null; })()`, 8000, 'the AC-3 file to be the one shown');
  t.check('AC-3 file opens', 'a video with AC-3 sound opens, and the Cutter knows this browser cannot decode its sound', ac3.state === 'ok' && ac3.picture && /ac-?3/i.test(ac3.sound || '') && ac3.canDecode === false, ac3);
  await page.eval(setSelect('#fmtSel', 'same')); await page.eval(`(__saved.length = 0, true)`);
  await page.click('#segPrec [data-v="exact"]');
  await page.click('#exportBtn');
  r = await finished('the exact cut of the AC-3 file to be refused');
  const wrote = await page.eval(`__saved.length`);
  t.check('AC-3 exact cut refused', 'the exact cut fails with the “cannot decode the sound” message and writes no file', r.fail && /cannot decode the sound/i.test(r.text) && /Untouched/.test(r.text) && wrote === 0, { failed: r.fail, files: wrote, says: r.text });
  await closeSheet();
  await page.click('#segPrec [data-v="copy"]');
  await page.click('#exportBtn');
  r = await finished('the untouched copy of the AC-3 file');
  const copy = await page.eval(`(() => { const s = __saved[__saved.length - 1], e = window.__lastExport; return s ? { name: s.name, bytes: s.file.size, seconds: e && e.length } : null; })()`);
  t.check('AC-3 untouched copy', 'the untouched copy is written: a file over 20 KB, within 0.1 s of the 4 s original', r.done && copy && copy.bytes > 20000 && Math.abs(copy.seconds - ac3.seconds) < 0.1, copy || r);
  await closeSheet();

  // ---- an exact cut of sound at a low sample rate (22 kHz MP3): the encoders do not work at that rate ----
  { const n0 = await page.eval(`__cutter.files.length`);
    await page.setFiles('#fileIn', [t.media.get('low-rate.mp3')]);
    await page.waitFor(`__cutter.files.length === ${n0 + 1} && __cutter.files[${n0}].state !== 'opening'`, 30000, 'the low-rate clip to open');
    await page.eval(`(() => { const f = __cutter.files[${n0}]; if (f.state === 'ok' && __cutter.cur !== f) document.querySelectorAll('#fileList > *')[${n0}].click(); return true; })()`);
    await page.waitFor(`__cutter.cur === __cutter.files[${n0}]`, 8000, 'the low-rate clip to be the one shown');
    const rate = await page.eval(`__cutter.cur.media.audio.sr + ' Hz ' + __cutter.cur.media.audio.codec`);
    await page.eval(`(__cutter.commit(__cutter.C.addPart([], 1, 3, __cutter.cur.media.duration)), true)`);
    await page.click('#segPrec [data-v="exact"]');
    const got = [];
    for (const fmt of ['same', 'ogg']) {
      if (!(await page.eval(setSelect('#fmtSel', fmt)))) { got.push({ fmt, skipped: 'this browser does not offer it' }); continue; }
      await page.eval(`(__saved.length = 0, true)`); await page.click('#exportBtn');
      const rr = await finished(`the exact cut of the low-rate clip (${fmt})`);
      const s = await page.eval(`(async () => { const s = __saved[__saved.length - 1]; if (!s) return null; const b = await s.file.arrayBuffer(), ctx = new OfflineAudioContext(1, 1, 44100); let seconds = null, peak = 0; try { const buf = await ctx.decodeAudioData(b); seconds = buf.length / buf.sampleRate; const d = buf.getChannelData(0); for (let i = 0; i < d.length; i += 7) peak = Math.max(peak, Math.abs(d[i])); } catch (e) {} return { name: s.name, seconds, peak: +peak.toFixed(3) }; })()`);
      got.push({ fmt, done: rr.done, fail: rr.fail ? rr.text.slice(0, 160) : undefined, ...(s || {}) }); await closeSheet();
    }
    t.check('exact cut at a low sample rate', 'a 22,050 Hz stereo MP3 cut exactly from 1 s to 3 s is written with no error, in its own format and as Ogg, each 2.00 s long (within 60 ms) and not silent',
      /22050 Hz mp3/.test(rate) && got.length === 2 && got.every(g => g.skipped || (g.done && g.seconds != null && Math.abs(g.seconds - 2) <= 0.06 && g.peak > 0.05)) && got[0].done === true, { source: rate, got });
    await page.eval(setSelect('#fmtSel', 'same')); }

  // ---- one side only: a call with each person on their own side is saved with one of them silenced ----
  { const n0 = await page.eval(`__cutter.files.length`);
    const monoShown = await page.eval(`(() => { const i = __cutter.files.findIndex(f => f.media && f.media.audio && f.media.audio.ch === 1); return i < 0 ? null : i; })()`);
    await page.setFiles('#fileIn', [t.media.get('two-sides.mp3')]);
    await page.waitFor(`__cutter.files.length === ${n0 + 1} && __cutter.files[${n0}].state !== 'opening'`, 30000, 'the two-sided clip to open');
    await page.eval(`(() => { const f = __cutter.files[${n0}]; if (f.state === 'ok' && __cutter.cur !== f) document.querySelectorAll('#fileList > *')[${n0}].click(); return true; })()`);
    await page.waitFor(`__cutter.cur === __cutter.files[${n0}] && !document.querySelector('#segSide').hidden`, 8000, 'the side choice to show for a stereo file');
    // a waveform for each voice, with its own mute
    await page.waitFor(`!document.querySelector('#laneMute').hidden && __cutter.cur.peaks && __cutter.cur.peaks.done`, 15000, 'a lane for each side');
    await page.click('#laneMute [data-side="R"]');
    const lm = await page.eval(`({ lanes: [...document.querySelectorAll('#laneMute button')].map(b => b.textContent + ':' + b.getAttribute('aria-pressed')).join(' '), side: [...document.querySelectorAll('#segSide button')].find(b => b.getAttribute('aria-pressed') === 'true').textContent, line: document.querySelector('#sum').textContent, h: +document.querySelector('#tl').dataset.h })`);
    await page.click('#laneMute [data-side="R"]');
    const lm2 = await page.eval(`[...document.querySelectorAll('#segSide button')].find(b => b.getAttribute('aria-pressed') === 'true').textContent`);
    t.check('a waveform for each voice', 'a two-sided file gets a lane per side with a mute on each; a real click on the right lane’s mute keeps only the left voice (the same as “Left only”, said in the export line), and a second click brings it back', lm.lanes === 'Left:false Right:true' && lm.side === 'Left only' && /left side only/.test(lm.line) && lm.h >= 240 && lm2 === 'Both voices', { ...lm, after: lm2 });
    // how much of each tone is in each side of a saved file (Goertzel), measured in the page
    const TONES = `async file => { const ctx = new OfflineAudioContext(2, 1, 44100), buf = await ctx.decodeAudioData(await file.arrayBuffer()), sr = buf.sampleRate, g = (d, hz) => { const w = 2 * Math.PI * hz / sr, c = 2 * Math.cos(w); let a = 0, b = 0; const n = Math.min(d.length, sr * 3), s0 = Math.floor(sr * 0.3); for (let i = s0; i < n; i++) { const x = d[i] + c * a - b; b = a; a = x; } return Math.sqrt(Math.max(0, a * a + b * b - c * a * b)) / (n - s0); }; const out = { seconds: +(buf.length / sr).toFixed(3), ch: buf.numberOfChannels }; for (let k = 0; k < buf.numberOfChannels; k++) { const d = buf.getChannelData(k); out['c' + k] = [g(d, 300), g(d, 1000)].map(v => +v.toFixed(4)); } return out; }`;
    await page.eval(setSelect('#fmtSel', 'same')); await page.click('#segPrec [data-v="copy"]');
    const got = {};
    for (const [v, word] of [['R', 'right'], ['L', 'left']]) {
      await page.click(`#segSide [data-v="${v}"]`);
      const sum = await page.eval(`document.querySelector('#sum').textContent`);
      await page.eval(`(__saved.length = 0, true)`); await page.click('#exportBtn');
      const rr = await finished(`the ${word} side to be written`);
      const s = await page.eval(`(async () => { const s = __saved[__saved.length - 1]; return s ? { name: s.name, ...(await (${TONES})(s.file)) } : null; })()`);
      got[v] = { done: rr.done, fail: rr.fail ? rr.text.slice(0, 140) : undefined, sum, ...(s || {}) }; await closeSheet();
    }
    const only = (g, keep, drop) => g && g.done && g.ch === 2 && Math.abs(g.seconds - 4.08) < 0.08 && [g.c0, g.c1].every(c => c[keep] > 0.05 && c[drop] < c[keep] / 30);
    t.check('one side only', 'with “Right only” chosen (a real click) and Untouched still on, the saved file has the right side’s 1000 Hz tone on both sides and none of the left’s 300 Hz; “Left only” the other way round; each file is as long as the original (4.08 s), its name says which side, and the export line says so before saving',
      only(got.R, 1, 0) && only(got.L, 0, 1) && /right side only/.test(got.R.name) && /left side only/.test(got.L.name) && /right side only/.test(got.R.sum) && /left side only/.test(got.L.sum), got);
    // Transcribe…, in the header: the open file goes to Transcripts as it is set here (the left side only)
    const o0 = await page.eval(`window.__opened.length`); await page.eval(`(__saved.length = 0, true)`);
    await page.click('#trBtn');
    await page.waitFor(`window.__opened.length === ${o0 + 1}`, 30000, 'the left side to be written and sent to Transcripts');
    const sentL = await page.eval(`({ opened: window.__opened[${o0}], saved: __saved.map(x => x.name) })`); await closeSheet();
    const trL = await t.open('/transcribe/' + sentL.opened.slice(sentL.opened.indexOf('?')), { site: { origin: page.origin }, preload: RETURNING });
    const thereL = await trL.waitFor(`window.__tr && __tr.cur && __tr.cur.media.readyState >= 1 ? { name: __tr.cur.track.name } : null`, 20000, 'Transcripts to open the left side').catch(e => ({ error: e.message })); await trL.close();
    t.check('Transcribe with one side', 'with “Left only” chosen, one real click on Transcribe writes the left side, saves it, and goes to Transcripts on that file', sentL.saved.length === 1 && /left side only/.test(sentL.saved[0]) && thereL && thereL.name === sentL.saved[0], { sentL, thereL });
    await page.click('#segSide [data-v=""]');
    await page.click('#trBtn');
    await page.waitFor(`window.__opened.length === ${o0 + 2}`, 15000, 'the untouched file to be sent to Transcripts');
    const plainT = await page.eval(`({ saved: __saved.length, sheet: !document.querySelector('#sheet').hidden })`);
    t.check('Transcribe untouched', 'with nothing changed, the file itself is sent: nothing new is written or saved', plainT.saved === 1 && !plainT.sheet, plainT);
    await page.eval(`(__saved.length = 0, true)`); await page.click('#exportBtn'); const rb = await finished('both sides, untouched');
    const both = await page.eval(`(async () => { const s = __saved[__saved.length - 1]; return s ? { name: s.name, ...(await (${TONES})(s.file)) } : null; })()`); await closeSheet();
    t.check('both sides again', 'back on “Both voices”, the file is saved as before: the left tone on the left, the right tone on the right, the name unchanged, still an MP3', rb.done && both && /\.mp3$/.test(both.name) && !/side only/.test(both.name) && both.c0[0] > 0.05 && both.c0[1] < both.c0[0] / 30 && both.c1[1] > 0.05 && both.c1[0] < both.c1[1] / 30, both);
    if (monoShown != null) { await page.eval(`(document.querySelectorAll('#fileList > *')[${monoShown}].click(), true)`); await page.waitFor(`__cutter.cur === __cutter.files[${monoShown}]`, 8000, 'the one-channel file'); t.check('no side choice for one channel', 'a file with one channel does not offer the choice', await page.eval(`document.querySelector('#segSide').hidden`), 'hidden'); }
    // ---- clearer speech: saved the way it is heard ----
    const n1 = await page.eval(`__cutter.files.length`);
    await page.setFiles('#fileIn', [t.media.get('two-sides-long.mp3')]);
    await page.waitFor(`__cutter.files.length === ${n1 + 1} && __cutter.files[${n1}].state !== 'opening'`, 30000, 'the quiet clip to open');
    await page.eval(`(() => { const f = __cutter.files[${n1}]; if (f.state === 'ok' && __cutter.cur !== f) document.querySelectorAll('#fileList > *')[${n1}].click(); return true; })()`);
    await page.waitFor(`__cutter.cur === __cutter.files[${n1}] && !document.querySelector('#clearBtn').hidden`, 8000, 'the Clearer speech button to show');
    const save = async what => { await page.eval(`(__saved.length = 0, true)`); await page.click('#exportBtn'); const rr = await finished(what); const s = await page.eval(`(async () => { const s = __saved[__saved.length - 1]; return s ? { name: s.name, ...(await (${TONES})(s.file)) } : null; })()`); await closeSheet(); return { done: rr.done, fail: rr.fail ? rr.text.slice(0, 140) : undefined, ...(s || {}) }; };
    const plain = await save('the quiet clip, untouched');
    await page.click('#clearBtn'); await t.sleep(4300); // its message has gone
    const sumC = await page.eval(`document.querySelector('#sum').textContent`), clear = await save('the quiet clip with clearer speech');
    const liftL = 20 * Math.log10(clear.c0[0] / plain.c0[0]), liftR = 20 * Math.log10(clear.c1[1] / plain.c1[1]);
    t.check('clearer speech is saved', 'with “Clearer speech” on (a real click) and Untouched still chosen, the quiet recording is saved at least 8 dB louder on both sides, each tone still only on its own side, the same length, with “clearer speech” in the export line and in the file name',
      plain.done && clear.done && liftL >= 8 && liftR >= 8 && clear.c0[1] < clear.c0[0] / 30 && clear.c1[0] < clear.c1[1] / 30 && Math.abs(clear.seconds - plain.seconds) < 0.08 && /clearer speech/.test(sumC) && /\(clearer speech\)/.test(clear.name), { plain, clear, lift_dB: [+liftL.toFixed(1), +liftR.toFixed(1)], line: sumC });
    // with clearer speech still on: Transcribe… sends the clearer file, and a join is clearer too
    const o1 = await page.eval(`window.__opened.length`); await page.eval(`(__saved.length = 0, true)`);
    await page.click('#trBtn');
    await page.waitFor(`window.__opened.length === ${o1 + 1}`, 30000, 'the clearer file to be written and sent to Transcripts');
    const sentC = await page.eval(`(async () => { const s = __saved[__saved.length - 1], id = new URL(window.__opened[${o1}], location.href).searchParams.get('song');
      const lib = await new Promise((res, rej) => { const r = indexedDB.open('mixtape-player'); r.onsuccess = () => { const q = r.result.transaction('tracks').objectStore('tracks').get(id); q.onsuccess = () => { r.result.close(); res(q.result); }; q.onerror = () => rej(q.error); }; r.onerror = () => rej(r.error); });
      return { saved: s && s.name, inLibrary: lib && lib.name, ...(lib ? await (${TONES})(lib.blob) : {}) }; })()`); await closeSheet();
    const liftT = sentC.c1 ? 20 * Math.log10(sentC.c1[1] / plain.c1[1]) : null;
    t.check('Transcribe carries clearer speech', 'with “Clearer speech” on, the file that Transcribe puts in the library for Transcripts is the clearer one: at least 8 dB louder than the original, with “clearer speech” in its name', liftT != null && liftT >= 8 && /clearer speech/.test(sentC.inLibrary || '') && sentC.inLibrary === sentC.saved, { ...sentC, lift_dB: liftT && +liftT.toFixed(1) });
    await page.eval(`(__saved.length = 0, true)`);
    await page.click('#joinBtn'); await page.waitFor(`document.querySelectorAll('#sheet #jl .joinrow').length > 1`, 5000, 'the join list');
    await page.click('#jNone'); const rowsJ = await page.eval(`[...document.querySelectorAll('#sheet #jl .joinrow')].map(r => r.textContent)`), want = rowsJ.map((x, i) => /two-sides-long/.test(x) ? i : -1).filter(i => i >= 0)[0], other = rowsJ.map((x, i) => /two-sides\.mp3/.test(x) ? i : -1).filter(i => i >= 0)[0];
    for (const k of [want, other]) { await page.eval(`(document.querySelector('#sheet #jl [data-c="${k}"]').scrollIntoView({ block: 'center' }), true)`); await page.click(`#sheet #jl [data-c="${k}"]`); } // the list scrolls: each row is brought into view, then clicked for real
    const jsumC = await page.eval(`document.querySelector('#jSum').textContent`); await page.click('#jGo');
    const rj = await finished('a join with clearer speech');
    const joinedC = await page.eval(`(async () => { const s = __saved.find(x => !/clip list/.test(x.name)); return s ? { name: s.name, ...(await (${TONES})(s.file)) } : null; })()`); await closeSheet();
    const quietFirst = want < other, liftJ = joinedC && quietFirst ? 20 * Math.log10(joinedC.c1[1] / plain.c1[1]) : null;
    t.check('a join with clearer speech', 'two files joined with “Clearer speech” on: the join window says so, the name says so, and the sound is clearer (where the quiet file comes first, at least 8 dB louder than it was)', rj.done && joinedC && /clearer speech/.test(jsumC) && /clearer speech/.test(joinedC.name) && (liftJ == null || liftJ >= 8), { sheet: jsumC, ...joinedC, quietFirst, lift_dB: liftJ && +liftJ.toFixed(1) });
    await page.click('#clearBtn');
    const again = await save('the quiet clip, untouched again');
    t.check('clearer speech off again', 'switched off, the file is saved as before: an MP3, the plain name, the same level', again.done && /\.mp3$/.test(again.name) && !/clearer/.test(again.name) && Math.abs(again.c1[1] - plain.c1[1]) < 0.002, again);
    await page.click('#segPrec [data-v="exact"]'); }

  // ---- the joined file, opened again, shows where each clip begins ----
  const before = await page.eval(`__cutter.files.length`);
  await page.eval(`(__joinedKeep && __cutter.openFiles([__joinedKeep], { show: true }), true)`);
  await page.waitFor(`__cutter.files.length === ${before + 1} && __cutter.files[${before}].state !== 'opening'`, 30000, 'the joined file to open');
  const marks = await page.eval(`(() => { const c = __cutter.cur; return { file: c.media.file.name, parts: c.parts.map(p => ({ name: p.name, t0: +p.t0.toFixed(3), t1: +p.t1.toFixed(3) })), length: +c.media.duration.toFixed(3), rows: document.querySelectorAll('#partList .pname').length, names: [...document.querySelectorAll('#partList .pname')].map(e => e.value) }; })()`);
  const ends = clips.slice(0).reduce((a, c) => [...a, (a[a.length - 1] || 0) + c.seconds], []);
  t.check('joined file shows its clips', 'opened again, the joined file has one part for each of the three clips, named after it, each beginning within 5 ms of where its clip was joined on, the last ending at the end of the file',
    marks.parts.length === 3 && marks.parts.map(p => p.name).join() === 'join-1,join-2,join-3' && marks.parts.every((p, i) => Math.abs(p.t0 - (i ? ends[i - 1] : 0)) <= 0.005) && Math.abs(marks.parts[2].t1 - marks.length) <= 0.005 && marks.names.join() === 'join-1,join-2,join-3', marks);

  const errs = page.errors.filter(e => !/cannot decode the sound/i.test(e)); // the refusal above is also written to the console, on purpose
  t.check('no errors', 'no errors in the console during the whole flow (apart from the refusal itself)', errs.length === 0, errs.length ? errs.slice(0, 4) : 'clean');
  t.private(page);
}
