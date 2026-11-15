// Studio: it boots with a mix, a song from the library goes onto a track, it plays, the mix saves as a file, and a
// short mix exports to a WAV that is not silent.
import { RETURNING, WAV_INFO } from '../lib/inpage.mjs';

export const needsBrowser = true;
const head = `parseFloat(document.querySelector('#playhead').style.left)`;

export async function run(t) {
  // the library is shared with the Player: the song is added there first, as a person would
  const site = await t.site(), page = await t.open('/', { site, preload: RETURNING });
  await page.waitFor(`window.__player && __player.store === 'ok'`, 15000, 'the Player’s library to open');
  await page.setFiles('#fileIn', [t.media.get('Checks - Song B.wav')]);
  await page.waitFor(`document.querySelectorAll('#list .row').length === 1`, 15000, 'the song to be in the library');
  await t.sleep(300);

  await page.goto('/studio.html');
  await page.waitFor(`window.__studio && __studio.P && __studio.lib && __studio.lib.length === 1`, 20000, 'the Studio to start and read the library');
  const boot = await page.eval(`({ name: __studio.P.name, shown: document.querySelector('#projName').value, tracks: __studio.P.lanes.length, parts: __studio.P.clips.length, lanesDrawn: document.querySelectorAll('#tl .lane, #lanes .lane, .lane').length })`);
  t.check('boots with a mix', 'a mix is open: it has a name (shown in the header) and at least one track', !!boot.name && boot.shown === boot.name && boot.tracks >= 1, boot);
  const lib = await page.eval(`[...document.querySelectorAll('#lib li[data-drag]')].map(l => l.querySelector('b').textContent)`);
  t.check('library shows the song', 'the song added in the Player is listed in the Studio’s library', lib.length === 1 && /Song B/.test(lib[0]), lib);

  // add it to the selected track with a real click on “Add”
  await page.click('#lib li[data-drag] [data-add="append"]');
  await page.waitFor(`__studio.P.clips.length === 1`, 15000, 'the song to land on a track');
  const part = await page.eval(`(() => { const c = __studio.P.clips[0], t = __studio.lib[0]; return { onTrack: __studio.P.lanes.some(l => l.id === c.lane), fromSong: c.trackId === t.id, at: c.at, seconds: +(c.end - c.start).toFixed(3) }; })()`);
  t.check('song added to a track', 'one part on a track, made from the library song, 5 s long, starting at 0', part.onTrack && part.fromSong && part.at === 0 && Math.abs(part.seconds - 5) < 0.05, part);
  await page.waitFor(`__studio.held.bufs.length >= 1`, 15000, 'the song’s sound to be ready').catch(() => {});
  // While a song's tempo and key are being found, its row says so. That label must stay in its row: measured on a
  // label of the same kind put into the list for a moment, so the answer does not depend on catching the real one.
  const label = await page.eval(`(() => { const li = document.createElement('li'); li.innerHTML = '<div><span class="bk finding">finding tempo and key…</span></div>'; document.querySelector('#lib').appendChild(li);
    const sp = li.querySelector('span'), cs = getComputedStyle(sp), r = sp.getBoundingClientRect(), out = { position: cs.position, width: Math.round(r.width), height: Math.round(r.height), window: innerWidth + 'x' + innerHeight }; li.remove(); return out; })()`);
  t.check('“finding tempo and key…” stays in its row', 'the label is an ordinary label in the library row (not fixed over the window, no wider than the library panel)', label.position !== 'fixed' && label.width < 400, label);
  await page.waitFor(`!document.querySelector('#lib .bk.finding')`, 30000, 'the song’s tempo and key to be found');

  // play with a real click, pause with the Space key
  const x0 = await page.eval(head);
  await page.click('#playBtn');
  await page.waitFor(`__studio.playing && ${head} > ${x0}`, 8000, 'the playhead to start moving').catch(() => {});
  const x1 = await page.eval(head), w1 = Date.now(); await t.sleep(1000);
  const x2 = await page.eval(head), sec = (Date.now() - w1) / 1000, pps = await page.eval(`__studio.pps`), moved = (x2 - x1) / pps, playing = await page.eval(`__studio.playing`);
  t.check('plays', 'while playing, the playhead advances at about one second a second (0.7–1.3×)', playing && moved / sec > 0.7 && moved / sec < 1.3, `${moved.toFixed(2)} s of mix in ${sec.toFixed(2)} s, playing: ${playing}, sound engine: ${await page.eval(`__studio.ctx.state`)}`);
  await page.eval(`document.activeElement && document.activeElement.blur()`);
  await page.press(' '); await t.sleep(300);
  const x3 = await page.eval(head); await t.sleep(400);
  const x4 = await page.eval(head), stopped = !(await page.eval(`__studio.playing`));
  t.check('Space pauses', 'pressing Space stops the playhead', stopped && Math.abs(x4 - x3) < 0.5, `playing: ${!stopped}, moved ${(x4 - x3).toFixed(2)} px after the press`);

  // Mixes ▸ Save this mix as a file…
  await page.click('#projBtn');
  await page.clickText('#menu', 'Save this mix as a file');
  await page.waitFor(`window.__chk.dl.some(d => /\\.json$/.test(d.name))`, 5000, 'the mix file');
  const mix = await page.eval(`(async () => { const d = window.__chk.dl.find(d => /\\.json$/.test(d.name)); let j = null; try { j = JSON.parse(await d.blob.text()); } catch (e) {} return { name: d.name, format: j && j.format, version: j && j.version, parts: j && j.mix && j.mix.clips && j.mix.clips.length, songs: j && j.songs && j.songs.map(s => s.name) }; })()`);
  t.check('save the mix as a file', 'a .mixtape.json file whose format is “mixtape.studio-mix”, holding the one part and naming its song', /\.mixtape\.json$/.test(mix.name) && mix.format === 'mixtape.studio-mix' && mix.parts === 1 && mix.songs && mix.songs[0] === 'Checks - Song B.wav', mix);

  // Export ▸ Export (the whole mix, to the library and as a WAV)
  await page.click('#saveBtn');
  await page.waitFor(`!document.querySelector('#modal').hidden`, 5000, 'the export box');
  await page.click('#mOk');
  await page.waitFor(`window.__chk.dl.some(d => /\\.wav$/.test(d.name))`, 60000, 'the exported WAV');
  const wav = await page.eval(`(async () => { const d = window.__chk.dl.find(d => /\\.wav$/.test(d.name)); return { name: d.name, ...(await (${WAV_INFO})(d.blob)) }; })()`);
  t.check('export to WAV', 'a WAV as long as the mix (5 s, ±0.1 s) whose samples are not all zero (loudest sample over 0.01)', !wav.error && Math.abs(wav.seconds - 5) < 0.1 && wav.peak > 0.01, wav);
  await page.waitFor(`__studio.lib.length === 2`, 8000, 'the export to join the library').catch(() => {});
  const inLib = await page.eval(`__studio.lib.map(x => x.title)`);
  t.check('export joins the library', 'the exported mix is also added to the library', inLib.length === 2, inLib);

  // the mix is still there after a reload
  await t.sleep(400); await page.reload();
  await page.waitFor(`window.__studio && __studio.P && __studio.lib && __studio.lib.length === 2`, 20000, 'the Studio after a reload');
  const again = await page.eval(`({ name: __studio.P.name, parts: __studio.P.clips.length })`);
  t.check('mix kept after a reload', 'the same mix opens again with its part', again.parts === 1 && again.name === boot.name, again);

  t.check('no errors', 'no errors in the console during the whole flow', page.errors.length === 0, page.errors.length ? page.errors.slice(0, 4) : 'clean');
  t.private(page);
}
