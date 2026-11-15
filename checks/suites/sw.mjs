// The service worker (offline copy): it installs on the test server, its cache holds every file on its CORE list, every
// CORE file exists on disk, and caches that belong to something else on the same address survive its activation.
import fs from 'node:fs';
import path from 'node:path';

export const needsBrowser = true;

export function readSw(root) {
  const src = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const version = (/const VERSION\s*=\s*['"]([^'"]+)['"]/.exec(src) || [])[1] || null;
  const m = /const CORE\s*=\s*\[([\s\S]*?)\];/.exec(src);
  const core = m ? [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : [];
  return { version, core };
}
const onDisk = (root, u) => { const rel = u.replace(/^\.\//, ''); return path.join(root, rel === '' || rel.endsWith('/') ? rel + 'index.html' : rel); };

export async function run(t) {
  const { version, core } = readSw(t.root);
  t.check('sw.js reads', 'a VERSION like mixtape-v<n> and a CORE list', /^mixtape-v\d+$/.test(version || '') && core.length > 10, `${version}, ${core.length} files`);
  const missing = core.filter(u => !fs.existsSync(onDisk(t.root, u)));
  t.check('CORE files exist', 'every file on the CORE list is on disk', missing.length === 0, missing.length ? missing : `${core.length} of ${core.length}`);
  const twice = core.filter((u, i) => core.indexOf(u) !== i);
  t.check('CORE has no repeats', 'no file is listed twice (a repeat makes the install fail)', twice.length === 0, twice.length ? twice : 'none');

  const page = await t.open('/__blank');
  // caches that are not Mixtape's own pages, and one old version that should go
  await page.eval(`(async () => { for (const k of ['scanline-test', 'mixtape-speaker-v1', 'mixtape-v1']) { const c = await caches.open(k); await c.put('/__kept', new Response('kept by ' + k)); } return true; })()`);
  const state = await page.eval(`(async () => {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const w = reg.installing || reg.waiting || reg.active;
    await new Promise((res, rej) => { const look = () => { if (w.state === 'activated') res(); else if (w.state === 'redundant') rej(new Error('the service worker did not install (a CORE file could not be fetched)')); }; w.addEventListener('statechange', look); look(); setTimeout(() => rej(new Error('the service worker was still ' + w.state + ' after 60 s')), 60000); });
    return w.state; })()`);
  t.check('installs and activates', 'the service worker reaches “activated” on the test server', state === 'activated', state);
  const got = await page.call(async (version, core) => {
    const keys = await caches.keys(), c = await caches.open(version), lacking = [];
    for (const u of core) { if (!(await c.match(new URL(u, location.origin + '/').href))) lacking.push(u); }
    const kept = {}; for (const k of ['scanline-test', 'mixtape-speaker-v1']) { const r = await (await caches.open(k)).match('/__kept'); kept[k] = keys.includes(k) && !!r && (await r.text()) === 'kept by ' + k; }
    return { keys, lacking, kept, cached: (await c.keys()).length };
  }, version, core);
  t.check('cache name', `a cache called ${version} exists`, got.keys.includes(version), got.keys);
  t.check('cache holds CORE', 'every CORE file is in the cache', got.lacking.length === 0, got.lacking.length ? got.lacking : `${core.length} of ${core.length} (${got.cached} entries)`);
  t.check('foreign caches survive', 'scanline-test and mixtape-speaker-v1 are still there, with their contents, after activation', got.kept['scanline-test'] && got.kept['mixtape-speaker-v1'], got.kept);
  t.check('old version cleared', 'the older copy of the pages (mixtape-v1) is deleted on activation', !got.keys.includes('mixtape-v1'), got.keys);
  t.private(page);
}
