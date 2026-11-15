// Player: add two songs, play one, make a playlist, reload: songs and playlist are still there.
import { RETURNING } from '../lib/inpage.mjs';

export const needsBrowser = true;

export async function run(t) {
  const a = t.media.get('Checks - Song A.mp3'), b = t.media.get('Checks - Song B.wav');
  const page = await t.open('/', { preload: RETURNING });
  await page.waitFor(`window.__player && __player.store === 'ok'`, 15000, 'the library to open');

  // add two songs through the page's own file input, as picking them would
  await page.setFiles('#fileIn', [a, b]);
  await page.waitFor(`document.querySelectorAll('#list .row').length === 2`, 15000, 'two songs in the list');
  const rows = await page.eval(`[...document.querySelectorAll('#list .row')].map(r => r.querySelector('.meta b').textContent + ' / ' + r.querySelector('.meta span').textContent + ' / ' + r.querySelector('.dur').textContent)`);
  t.check('two songs added', 'both songs show in the list, with title, artist and length', rows.length === 2 && rows.some(r => /Song A/.test(r) && /Checks/.test(r)) && rows.some(r => /Song B/.test(r)) && rows.every(r => /0:0[4-6]/.test(r)), rows);
  t.check('song count', 'the header says “2 songs”', /\b2 songs\b/.test(await page.eval(`document.querySelector('#libCount').textContent`)), await page.eval(`document.querySelector('#libCount').textContent`));

  // play one with a real click on its row
  await page.click('#list .row .meta');
  await page.waitFor(`!document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 0.3`, 8000, 'the song to start playing').catch(() => {});
  const t1 = await page.eval(`document.querySelector('#audio').currentTime`); await t.sleep(1000);
  const t2 = await page.eval(`document.querySelector('#audio').currentTime`), playing = await page.eval(`!document.querySelector('#audio').paused`);
  t.check('a clicked song plays', 'the position advances by 0.7–1.4 s over one second', playing && t2 - t1 > 0.7 && t2 - t1 < 1.4, `${t1.toFixed(2)} s → ${t2.toFixed(2)} s, playing: ${playing}`);
  t.check('now-playing bar', 'the bar names the song that is playing', /Song [AB]/.test(await page.eval(`document.querySelector('#barTitle').textContent`)), await page.eval(`document.querySelector('#barTitle').textContent`));

  // Space pauses (a real key press, with the focus on the page and not in a field)
  await page.eval(`document.activeElement && document.activeElement.blur()`);
  await page.press(' '); await t.sleep(300);
  const paused = await page.eval(`document.querySelector('#audio').paused`);
  t.check('Space pauses', 'pressing Space while a song plays pauses it', paused === true, `paused: ${paused}`);

  // make a playlist: click “+ New playlist”, type a name, Enter
  await page.click('[data-act="newlist"]');
  await page.waitFor(`!document.querySelector('#modal').hidden && document.activeElement === document.querySelector('#mInput')`, 5000, 'the name box to open with the cursor in it');
  await page.type('Check list'); await page.press('Enter');
  await page.waitFor(`__player.lists.length === 1`, 5000, 'the playlist to be made');
  const chip = await page.eval(`[...document.querySelectorAll('#nav .chip')].map(c => c.textContent.trim())`);
  t.check('playlist made', 'a playlist called “Check list” shows among the views', chip.some(c => /^Check list/.test(c)), chip);

  // put a song in it through the song's menu
  await page.click('[data-act="view"][data-type="all"]');
  await page.waitFor(`document.querySelectorAll('#list .row').length === 2`, 5000, 'the song list to show again');
  await page.click('#list .row [data-row="more"]');
  await page.clickText('#menu', 'Add to playlist');
  await page.clickText('#menu', 'Check list');
  await page.waitFor(`__player.lists[0].ids.length === 1`, 5000, 'the song to join the playlist');
  await t.sleep(400); // the write to storage

  // reload: both are still there
  await page.reload();
  await page.waitFor(`window.__player && __player.store === 'ok' && __player.listsOk && document.querySelectorAll('#list .row').length > 0`, 15000, 'the library after reloading');
  const after = await page.eval(`({ rows: document.querySelectorAll('#list .row').length, songs: __player.songIds().length, lists: __player.lists.map(l => l.name + ':' + l.ids.length), chips: [...document.querySelectorAll('#nav .chip')].map(c => c.textContent.trim()), blobs: [...__player.tracks.values()].every(x => (x.blob && x.blob.size > 1000) || x.buf) })`);
  t.check('songs persist', 'after a reload both songs are listed and their sound is still stored', after.rows === 2 && after.songs === 2 && after.blobs, after);
  t.check('playlist persists', 'after a reload “Check list” is there with its one song', after.lists.length === 1 && after.lists[0] === 'Check list:1' && after.chips.some(c => /^Check list/.test(c)), after.lists);
  // and a stored song still plays
  await page.click('#list .row .meta');
  const plays = await page.waitFor(`!document.querySelector('#audio').paused && document.querySelector('#audio').currentTime > 0.3`, 8000, 'a stored song to play').then(() => true, () => false);
  t.check('a stored song plays after reload', 'the position advances', plays, `position ${(await page.eval(`document.querySelector('#audio').currentTime`)).toFixed(2)} s`);
  t.check('no errors', 'no errors in the console during the whole flow', page.errors.length === 0, page.errors.length ? page.errors.slice(0, 4) : 'clean');
  t.private(page);
}
