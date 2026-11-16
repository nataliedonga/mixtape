// The shared sound control (sound.js): "Clearer speech" and "Left only / Right only" while listening, in the Player and
// in Transcripts. What is measured is the sound on its way out of the page, after the control: two analysers are hung
// on the processor's output, one per side, and read while a made-up recording plays (300 Hz on the left, 1000 Hz on
// the right, both quiet). The control itself is worked with real clicks.
import { RETURNING } from '../lib/inpage.mjs';

export const needsBrowser = true;

// hang the analysers on the processor's output (once), then read each side's level at 300 Hz and at 1000 Hz, in dB
const READ = `(async () => {
  const s = window.__sound, node = [...s.nodes][0]; if (!node) return null; const ctx = s.ctx;
  if (!window.__tap) { const sp = ctx.createChannelSplitter(2), a = [ctx.createAnalyser(), ctx.createAnalyser()]; node.connect(sp); a.forEach((x, k) => { x.fftSize = 8192; x.smoothingTimeConstant = 0; sp.connect(x, k); }); window.__tap = a; }
  await new Promise(r => setTimeout(r, 900));
  const out = { state: ctx.state }; window.__tap.forEach((x, k) => { const d = new Float32Array(x.frequencyBinCount); x.getFloatFrequencyData(d); const at = hz => { const b = Math.round(hz * x.fftSize / ctx.sampleRate); return Math.round(Math.max(d[b - 1], d[b], d[b + 1])); }; out[k ? 'right' : 'left'] = { hz300: at(300), hz1000: at(1000) }; });
  return out; })()`;
const has = v => v > -75, none = (v, ref) => v < ref - 35;

async function listen(t, page, name, playing) {
  await page.click('#soundBtn');
  await page.click('#soundSide [data-v="R"]');
  await page.waitFor(`window.__sound.nodes.size > 0`, 8000, 'the sound path to be made (the first time only)');
  const right = await page.eval(READ), label = await page.eval(`document.querySelector('#soundBtn').textContent`);
  t.check(`${name}: right only`, 'after a real click on “Right only”, both sides carry the right side’s 1000 Hz tone and the left’s 300 Hz is gone (35 dB down or more); the button says so; the recording is still playing',
    right && right.state === 'running' && has(right.left.hz1000) && has(right.right.hz1000) && none(right.left.hz300, right.left.hz1000) && none(right.right.hz300, right.right.hz1000) && /right only/.test(label) && await page.eval(playing), { ...right, button: label });
  await page.click('#soundSide [data-v="L"]');
  const left = await page.eval(READ);
  t.check(`${name}: left only`, '“Left only”: both sides carry the 300 Hz tone and the 1000 Hz is gone', left && has(left.left.hz300) && has(left.right.hz300) && none(left.left.hz1000, left.left.hz300) && none(left.right.hz1000, left.right.hz300), left);
  await page.click('#soundSide [data-v=""]');
  const both = await page.eval(READ);
  t.check(`${name}: both again`, '“Both”: each tone is back on its own side only', both && has(both.left.hz300) && none(both.left.hz1000, both.left.hz300) && has(both.right.hz1000) && none(both.right.hz300, both.right.hz1000), both);
  await page.click('#soundClear');
  const clear = await page.eval(READ), lift = clear && both ? clear.right.hz1000 - both.right.hz1000 : null;
  t.check(`${name}: clearer speech`, 'ticking “Clearer speech” brings the quiet recording up by at least 8 dB, and it is remembered on this device', lift != null && lift >= 8 && await page.eval(`localStorage.getItem('mixtape-clearer-speech') === '1'`), { before: both && both.right.hz1000, after: clear && clear.right.hz1000, lift });
  await page.click('#soundClear');
  const off = await page.eval(READ);
  t.check(`${name}: off again`, 'unticked, the level is back where it was (within 2 dB)', off && Math.abs(off.right.hz1000 - both.right.hz1000) <= 2, { before: both.right.hz1000, after: off.right.hz1000 });
  await page.press('Escape');
}

export async function run(t) {
  const clip = t.media.get('two-sides-long.mp3');

  // ---- the Player ----
  let page = await t.open('/', { preload: RETURNING });
  await page.waitFor(`window.__player && __player.store === 'ok'`, 15000, 'the library to open');
  await page.waitFor(`!!document.querySelector('#soundBtn')`, 8000, 'the Sound button');
  const untouched = await page.eval(`!window.__sound.ctx && window.__sound.nodes.size === 0`);
  t.check('player: nothing routed until asked', 'before the control is used, no sound path has been made: the Player plays as it always did', untouched, untouched ? 'no audio context yet' : 'an audio context exists already');
  await page.setFiles('#fileIn', [clip]);
  await page.waitFor(`document.querySelectorAll('#list .row').length === 1`, 15000, 'the song in the list');
  await page.click('#list .row .meta');
  await page.waitFor(`!document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 0.3`, 8000, 'the song to start playing');
  await page.click('[data-act="open"]'); await page.waitFor(`!document.querySelector('#now').hidden`, 5000, 'Now Playing to open'); // the Sound button sits with speed and the sleep timer
  await listen(t, page, 'player', `(async () => { const a = document.querySelector('#audio'), t0 = a.currentTime; await new Promise(r => setTimeout(r, 500)); return !a.paused && a.currentTime > t0; })()`);
  t.check('player: no errors', 'no errors in the console', page.errors.length === 0, page.errors.length ? page.errors.slice(0, 3) : 'clean');
  t.private(page, 'player: nothing asked of another server');

  // ---- Transcripts: each recording has its own player; the control follows to the next one ----
  page = await t.open('/transcribe/', { preload: RETURNING });
  await page.waitFor('window.__tr', 15000, 'Transcripts to start');
  await page.setFiles('#fileIn', [clip]);
  await page.waitFor(`__tr.cur && __tr.cur.track.name === 'two-sides-long.mp3' && __tr.cur.media.readyState >= 1`, 20000, 'the recording to open');
  await page.waitFor(`!!document.querySelector('#soundBtn')`, 8000, 'the Sound button');
  await page.eval(`(__tr.cur.media.loop = true, __tr.cur.media.play(), true)`);
  await page.waitFor(`!__tr.cur.media.paused && __tr.cur.media.currentTime > 0.3`, 8000, 'the recording to start playing');
  await listen(t, page, 'transcripts', `(async () => { const a = __tr.cur.media, t0 = a.currentTime; await new Promise(r => setTimeout(r, 500)); return !a.paused && a.currentTime !== t0; })()`);
  await page.click('#soundBtn'); await page.click('#soundSide [data-v="R"]'); await page.press('Escape');
  await page.eval(`(__tr.cur.media.pause(), true)`);
  await page.setFiles('#fileIn', [t.media.get('talk.mp3')]);
  await page.waitFor(`__tr.cur && __tr.cur.track.name === 'talk.mp3' && __tr.cur.media.readyState >= 1`, 20000, 'a second recording to open');
  await page.waitFor(`window.__sound.wired.has(__tr.cur.media)`, 8000, 'the second recording’s player to be sent through the control').then(() => t.check('transcripts: follows to the next recording', 'with a side still chosen, the next recording opened is sent through the control too', true, 'wired'), e => t.check('transcripts: follows to the next recording', 'with a side still chosen, the next recording opened is sent through the control too', false, e.message));
  t.check('transcripts: no errors', 'no errors in the console', page.errors.length === 0, page.errors.length ? page.errors.slice(0, 3) : 'clean');
  t.private(page, 'transcripts: nothing asked of another server');
}
