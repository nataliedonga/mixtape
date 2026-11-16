// Cutter: an exact cut is exact, a join is as long as its clips, sound the browser cannot decode is refused on an
// exact cut with a plain message, and the untouched copy of it works.
import { RETURNING, WAV_INFO } from '../lib/inpage.mjs';

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
