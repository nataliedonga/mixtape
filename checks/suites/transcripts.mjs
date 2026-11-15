// Transcripts: a recording and its words open together; a click on a word plays from that word; Back is 10 s and
// Forward is 5 s; a recording that arrives marked sensitive is locked and every file saved from it says so.
// With FULL=1: a clip is transcribed end to end with the recogniser that ships in vendor/asr/, with no outside request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RETURNING } from '../lib/inpage.mjs';

export const needsBrowser = true;
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
// The AI-check button only exists where there is a studio server to send to. The check gives the page an address on the
// test server (never called), so that the button is there to be locked.
const PRELOAD = RETURNING + `\nwindow.MIXTAPE_REVIEW_URL = '/__review-not-called';`;
const media = `__tr.cur.media`;

export async function run(t) {
  const words = JSON.parse(fs.readFileSync(path.join(FIX, 'talk.read-along.json'), 'utf8')).words;
  // the fixtures are copied into this run's folder so the files handed to the browser are the run's own
  const dir = path.join(t.work, 'transcripts'); fs.mkdirSync(dir, { recursive: true });
  for (const f of ['talk.read-along.json', 'private.read-along.json']) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
  const page = await t.open('/transcribe/', { preload: PRELOAD });
  await page.waitFor('window.__tr', 15000, 'Transcripts to start');

  // ---- 1. a recording and its words, picked together ----
  await page.setFiles('#fileIn', [t.media.get('talk.mp3'), path.join(dir, 'talk.read-along.json')]);
  await page.waitFor(`__tr.cur && __tr.cur.tr && __tr.cur.track.name === 'talk.mp3' && document.querySelectorAll('#text .w').length > 0 && ${media}.readyState >= 1`, 20000, 'the recording and its words to open');
  const opened = await page.eval(`({ words: document.querySelectorAll('#text .w').length, title: document.querySelector('#title').textContent, meta: document.querySelector('#meta').textContent, seconds: ${media}.duration, bar: !document.querySelector('#pb').hidden })`);
  t.check('recording and words open', `all ${words.length} words show, under the recording’s title, with a 30 s recording behind them`, opened.words === words.length && /talk/.test(opened.title) && Math.abs(opened.seconds - 30) < 0.2 && opened.bar, opened);

  // ---- 2. click a word: playback moves to its time ----
  const k = 12, at = words[k].s;
  await page.click(`#text .w[data-i="${k}"]`);
  await page.waitFor(`!${media}.paused && ${media}.currentTime >= ${at}`, 8000, 'playback to start at the word').catch(() => {});
  const p1 = await page.eval(`({ t: ${media}.currentTime, playing: !${media}.paused })`);
  t.check('click a word', `clicking word ${k + 1} (“${words[k].t}”, at ${at} s) plays from ${at} s: the position is between ${at} and ${at + 1.5} s and moving`, p1.playing && p1.t >= at - 0.01 && p1.t < at + 1.5, p1);
  await page.waitFor(`document.querySelector('#text .w.on')`, 3000, 'the spoken word to light').catch(() => {});
  const lit = await page.eval(`(() => { const w = document.querySelector('#text .w.on'); return w ? +w.dataset.i : null; })()`);
  t.check('spoken word lights', `the lit word is the one being spoken (word ${k + 1} or the next)`, lit === k || lit === k + 1, `word ${lit == null ? 'none' : lit + 1}`);

  // ---- 3. Back 10 s, Forward 5 s (paused, so the numbers are exact) ----
  await page.click('#bPlay');
  await page.waitFor(`${media}.paused`, 3000, 'playback to pause');
  const a = await page.eval(`${media}.currentTime`);
  await page.click('#bBack'); await t.sleep(250);
  const b = await page.eval(`${media}.currentTime`);
  await page.click('#bFwd'); await t.sleep(250);
  const c = await page.eval(`${media}.currentTime`);
  t.check('Back button', 'Back moves the position by −10 s (±0.05 s)', Math.abs(b - (a - 10)) < 0.05, `${a.toFixed(2)} s → ${b.toFixed(2)} s (${(b - a).toFixed(2)} s)`);
  t.check('Forward button', 'Forward moves the position by +5 s (±0.05 s)', Math.abs(c - (b + 5)) < 0.05, `${b.toFixed(2)} s → ${c.toFixed(2)} s (+${(c - b).toFixed(2)} s)`);

  // ---- 4. an ordinary recording: the AI check is there, and its files are named plainly ----
  const exportAll = async () => {
    await page.eval(`(window.__chk.dl.length = 0, true)`);
    for (const item of ['Text with timestamps', 'Plain text', 'Subtitles (.srt)', 'Web subtitles', 'Words with times']) { await page.click('#exportBtn'); await page.waitFor(`!document.querySelector('#menu').hidden`, 3000, 'the save menu'); await page.clickText('#menu', item); await t.sleep(80); }
    return page.eval(`Promise.all(window.__chk.dl.map(async d => ({ name: d.name, head: d.blob ? (await d.blob.text()).slice(0, 400) : null })))`);
  };
  const ai1 = await page.eval(`(() => { const b = document.querySelector('#tools .aibtn'); return b ? { there: true, disabled: b.disabled, opens: b.hasAttribute('data-ai') } : { there: false }; })()`);
  const plain = await exportAll();
  t.check('ordinary recording: AI check offered', 'the AI-check button is there and enabled (so the lock below means something)', ai1.there && !ai1.disabled && ai1.opens, ai1);
  t.check('ordinary recording: file names', 'five files, none marked SENSITIVE', plain.length === 5 && plain.every(f => !/SENSITIVE/i.test(f.name) && !/SENSITIVE/.test(f.head || '')), plain.map(f => f.name));

  // ---- 5. a recording that arrives marked sensitive ----
  await page.setFiles('#fileIn', [t.media.get('private.mp3'), path.join(dir, 'private.read-along.json')]);
  await page.waitFor(`__tr.cur && __tr.cur.tr && __tr.cur.track.name === 'private.mp3' && document.querySelectorAll('#text .w').length > 0`, 20000, 'the sensitive recording to open');
  const lock = await page.eval(`(() => { const b = document.querySelector('#tools .aibtn'), s = document.querySelector('#sensBtn'), row = document.querySelector('#libL li.on');
    return { marked: __tr.sensitive(__tr.cur.track.id), badge: s.getAttribute('aria-pressed') === 'true' && /Sensitive/.test(s.textContent), aiThere: !!b, aiDisabled: b ? b.disabled : null, aiOpens: !!document.querySelector('#tools [data-ai]'), listLock: !!(row && row.querySelector('.lock')) }; })()`);
  t.check('sensitive: locked', 'imported with "sensitive": true, the recording is marked, shows a lock in the list, and the AI check is absent or disabled', lock.marked && lock.badge && lock.listLock && !lock.aiOpens && (!lock.aiThere || lock.aiDisabled === true), lock);
  // a real click on the locked button must do nothing
  if (lock.aiThere) { const moved = await page.click('#tools .aibtn').then(() => 'the click went through', e => e.message); const menu = await page.eval(`!document.querySelector('#menu').hidden && /AI check/.test(document.querySelector('#menu').textContent)`); t.check('sensitive: AI check cannot be opened', 'clicking the locked button opens nothing', !menu, `${moved}; AI menu open: ${menu}`); }
  const priv = await exportAll();
  t.check('sensitive: file names', 'all five saved files have (SENSITIVE) in their names', priv.length === 5 && priv.every(f => /\(SENSITIVE\)/.test(f.name)), priv.map(f => f.name));
  const txt = priv.filter(f => /\.txt$/.test(f.name)), vtt = priv.find(f => /\.vtt$/.test(f.name)), json = priv.find(f => /\.json$/.test(f.name));
  t.check('sensitive: said inside the files', 'the text files start with the SENSITIVE line, the .vtt carries it as a note, and the .json says "sensitive": true', txt.length === 2 && txt.every(f => /^SENSITIVE:/.test(f.head)) && vtt && /NOTE SENSITIVE:/.test(vtt.head) && json && /"sensitive":\s*true/.test(json.head), { txt: txt.map(f => f.head.slice(0, 30)), vtt: vtt && vtt.head.slice(0, 40).replace(/\n/g, ' '), json: json && /"sensitive":\s*true/.test(json.head) });

  // ---- 6. the mark is kept ----
  await page.reload();
  await page.waitFor(`window.__tr && document.querySelectorAll('#libL li[data-id]').length === 2`, 15000, 'the two recordings to be listed after a reload');
  await page.click({ name: 'the sensitive recording in the list', js: `[...document.querySelectorAll('#libL li[data-id]')].find(li => /private/.test(li.textContent))` });
  await page.waitFor(`__tr.cur && __tr.cur.track.name === 'private.mp3' && __tr.cur.tr`, 10000, 'the sensitive recording to open again');
  const kept = await page.eval(`({ marked: __tr.sensitive(__tr.cur.track.id), words: document.querySelectorAll('#text .w').length, aiOpens: !!document.querySelector('#tools [data-ai]') })`);
  t.check('sensitive: kept after a reload', 'after a reload the recording and its words are still there, still marked, the AI check still locked', kept.marked && kept.words === words.length && !kept.aiOpens, kept);

  const called = page.requests.filter(r => /__review-not-called/.test(r.url)).length;
  t.check('nothing sent for review', 'the AI-check address is never called', called === 0, `${called} calls`);
  t.check('no errors', 'no errors in the console during the whole flow', page.errors.length === 0, page.errors.length ? page.errors.slice(0, 4) : 'clean');
  t.private(page);

  if (t.full) await endToEnd(t); else t.note('the end-to-end recogniser check is skipped (run with FULL=1 to include it; it takes about a minute)');
}

// FULL=1: transcribe 20 seconds in which nobody speaks, with the recogniser that ships in vendor/asr/
async function endToEnd(t) {
  const page = await t.open('/transcribe/', { preload: RETURNING });
  await page.waitFor('window.__tr', 15000, 'Transcripts to start');
  await page.setFiles('#fileIn', [t.media.get('nobody-speaking.wav')]);
  await page.waitFor(`__tr.cur && __tr.cur.track.name === 'nobody-speaking.wav' && !document.querySelector('#start').hidden`, 20000, 'the clip to open');
  const t0 = Date.now();
  await page.click('#goHeard');
  await page.waitFor(`__tr.cur.tr && __tr.cur.tr.done && !__tr.job`, 540000, 'the transcript to finish');
  const asr = page.requests.filter(r => /\/vendor\/asr\//.test(r.url)), fromWorkers = asr.filter(r => r.from !== 'page').length;
  const tr = await page.eval(`({ done: __tr.cur.tr.done, words: __tr.cur.tr.words.length, upTo: __tr.cur.tr.upTo, text: __tr.cur.tr.words.map(w => w.t).join(' ').slice(0, 120) })`);
  t.check('FULL: transcribes end to end', 'the 20 s clip is heard to its end and the transcript is marked finished', tr.done && tr.upTo >= 19, { done: tr.done, upTo: tr.upTo, took_s: Math.round((Date.now() - t0) / 1000) });
  // what it wrote is not judged: nobody speaks in the clip (a low hum), and the recogniser may still write words for it
  t.note(`FULL: for 20 s of hum with nobody speaking the recogniser wrote ${tr.words} words${tr.words ? `: “${tr.text.slice(0, 60)}…”` : ''}`);
  t.check('FULL: recogniser comes from vendor/asr/', 'the library, its runtime and the model are fetched from vendor/asr/ on the test server', asr.some(r => /transformers\.min\.js/.test(r.url)) && asr.some(r => /\.onnx/.test(r.url)) && asr.some(r => /\.wasm/.test(r.url)), `${asr.length} files from vendor/asr/ (${fromWorkers} asked for by workers)`);
  t.check('FULL: no errors', 'no errors in the console, and no failed request', page.errors.length === 0 && page.failed.length === 0, page.errors.concat(page.failed).slice(0, 4).join(' / ') || 'clean');
  t.private(page, 'FULL: nothing asked of another server');
}
