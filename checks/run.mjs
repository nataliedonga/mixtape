// Mixtape's pre-release check: opens every tool in a real browser and does the basics, so an update cannot quietly
// break something.
//
//   node checks/run.mjs                 everything
//   node checks/run.mjs cutter reader   only those
//   HEADED=1 node checks/run.mjs        watch it happen
//   FULL=1 node checks/run.mjs          also transcribe a clip end to end with the bundled recogniser (slow)
//
// Safety: the run makes two folders of its own in the system temp folder (a browser profile and a work folder) and
// deletes only those two when it ends. It never opens your own browser profile, never writes to Downloads (files the
// pages "download" are read inside the page and never written), and never deletes a folder it did not make.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startServer } from './lib/server.mjs';
import { launch, sleep } from './lib/browser.mjs';
import { makeMedia } from './lib/media.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '..');
const SUITES = ['static', 'node', 'pages', 'sw', 'player', 'cutter', 'transcripts', 'guides', 'studio', 'reader', 'sound'];
const ALIAS = { transcribe: 'transcripts', transcript: 'transcripts', serviceworker: 'sw', 'service-worker': 'sw', page: 'pages', suites: 'node' };
const LIMIT = { transcripts: process.env.FULL ? 600 : 120 }; // seconds a suite may take before it is given up on (default 120)

const asked = process.argv.slice(2).map(a => ALIAS[a.toLowerCase()] || a.toLowerCase());
const unknown = asked.filter(a => !SUITES.includes(a));
if (unknown.length) { console.error(`Unknown check: ${unknown.join(', ')}. Choose from: ${SUITES.join(', ')}.`); process.exit(2); }
const chosen = asked.length ? SUITES.filter(s => asked.includes(s)) : SUITES;

// ---- the two folders this run owns ----
const made = [];
const mkTemp = prefix => { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); made.push(path.resolve(d)); return d; };
function removeOwn(dir) { // deletes a folder only if this run made it, inside the system temp folder
  const d = path.resolve(dir), tmp = path.resolve(os.tmpdir());
  if (!made.includes(d) || !d.startsWith(tmp + path.sep) || !/^mixtape-checks-(profile|work)-/.test(path.basename(d))) throw new Error(`refusing to delete ${d}: this run did not make it`);
  for (let i = 0; i < 40; i++) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 }); if (!fs.existsSync(d)) return true; } catch (e) {} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300); }
  return !fs.existsSync(d);
}

const results = [];
const show = v => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > 600 ? s.slice(0, 600) + '…' : s; };
const record = (suite, name, want, ok, got) => { results.push({ suite, name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${suite} › ${name}  |  want: ${want}  |  got: ${show(got)}`); };

let browser = null, work = null, profile = null, media = null;
async function cleanup() {
  if (browser) { await browser.close().catch(() => {}); browser = null; }
  for (const d of [profile, work]) if (d) { try { if (!removeOwn(d)) console.log(`note: could not delete the temp folder ${d} (still in use); it is safe to delete by hand`); } catch (e) { console.log('note: ' + e.message); } }
  profile = work = null;
}
process.on('SIGINT', () => { if (browser) browser.kill(); process.exit(130); });

const t0 = Date.now();
try {
  work = mkTemp('mixtape-checks-work-'); media = makeMedia(path.join(work, 'media'));
  const mods = {};
  for (const s of chosen) mods[s] = await import(pathToFileURL(path.join(HERE, 'suites', s + '.mjs')).href);
  if (chosen.some(s => mods[s].needsBrowser)) {
    profile = mkTemp('mixtape-checks-profile-');
    browser = await launch({ profileDir: profile, headed: !!process.env.HEADED });
    console.log(`Browser: ${browser.name}${process.env.HEADED ? '' : ' (headless)'} · profile and work folders are in ${os.tmpdir()}`);
  }
  for (const s of chosen) {
    const started = Date.now(), opened = [], sites = [];
    const t = {
      root: ROOT, work, media, full: !!process.env.FULL, sleep,
      check: (name, want, ok, got) => record(s, name, want, ok, got),
      note: msg => console.log(`note  ${s} › ${msg}`),
      // a site address of its own for this check (so its saved songs and settings are its own), and a tab on it
      async site() { const sv = await startServer(ROOT); sites.push(sv); return sv; },
      async open(pagePath, { site = null, preload = null } = {}) {
        const sv = site || await t.site(), page = await browser.newPage(sv.origin); opened.push(page);
        if (preload) await page.preload(preload);
        if (pagePath) await page.goto(pagePath);
        return page;
      },
      // the product's promise: nothing is asked of any other server, by the page or by its workers
      private(page, name = 'nothing asked of another server') { record(s, name, 'every request (page and workers) goes to the test server only', page.outside.length === 0, page.outside.length ? page.outside.slice(0, 5) : `${page.requests.length} requests, all to ${page.origin}`); },
    };
    const limit = (LIMIT[s] || 120) * 1000; let timer;
    try {
      await Promise.race([mods[s].run(t), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`gave up after ${limit / 1000} s`)), limit); })]);
    } catch (e) { const errs = opened.flatMap(p => p.errors).slice(0, 3); record(s, 'the check ran to the end', 'no step throws or hangs', false, (e.message || String(e)) + (errs.length ? ' · errors on the page: ' + errs.join(' / ') : '')); }
    clearTimeout(timer);
    for (const p of opened) await p.close().catch(() => {});
    for (const sv of sites) await sv.close().catch(() => {});
    console.log(`      ${s}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
} catch (e) {
  record('run', 'the run started', 'the browser and the test server start', false, e.message || String(e));
} finally { await cleanup(); }

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
if (failed.length) { console.log('FAILED:'); for (const f of failed) console.log(`  ${f.suite} › ${f.name}`); }
process.exit(failed.length ? 1 : 0);
