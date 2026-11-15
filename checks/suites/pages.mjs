// Every page loads cleanly: no errors in the console, nothing refused by the page's Content-Security-Policy, no failed
// request, and no request to any host other than the test server (from the page or from its workers).
import fs from 'node:fs';
import path from 'node:path';

export const needsBrowser = true;
const PAGES = [['/', 'index.html'], ['/studio.html', 'studio.html'], ['/cutter/', 'cutter/index.html'], ['/transcribe/', 'transcribe/index.html'], ['/reader/', 'reader/index.html'], ['/home/', 'home/index.html'], ['/storage/', 'storage/index.html']];
const REQUIRED = 5; // the first five must exist; /home/ and /storage/ are checked when they are there

// The watcher itself: a request to another server, made on purpose from a blank page and from a worker, must be seen.
// (The address ends in .invalid, which never exists, and the browser is started so that no outside name resolves:
// the attempt is noticed but nothing leaves this computer.)
async function watcherWorks(t) {
  const page = await t.open('/__blank');
  const fromPage = await page.eval(`fetch('https://from-the-page.mixtape-checks.invalid/ping').then(() => 'answered', () => 'went nowhere')`);
  const fromWorker = await page.eval(`new Promise(res => { const w = new Worker(URL.createObjectURL(new Blob(["fetch('https://from-a-worker.mixtape-checks.invalid/ping').then(() => 'answered', () => 'went nowhere').then(r => postMessage(r))"], { type: 'text/javascript' }))); w.onmessage = e => res(e.data); setTimeout(() => res('no answer from the worker'), 8000); })`);
  await t.sleep(300);
  const seen = { page: page.outside.some(o => /from-the-page/.test(o)), worker: page.outside.some(o => /from-a-worker/.test(o) && /worker/.test(o.split('(').pop())) };
  t.check('the watcher sees outside requests', 'a request to another server made on purpose is noticed, both from a page and from a worker, and goes nowhere', seen.page && seen.worker && fromPage === 'went nowhere' && fromWorker === 'went nowhere', { seenFromPage: seen.page, seenFromWorker: seen.worker, fromPage, fromWorker });
  await page.close();
}

export async function run(t) {
  await watcherWorks(t).catch(e => t.check('the watcher sees outside requests', 'the self-test runs', false, e.message));
  for (const [i, [url, file]] of PAGES.entries()) {
    if (!fs.existsSync(path.join(t.root, file))) { if (i < REQUIRED) t.check(`${url} loads`, 'the page exists', false, `${file} is missing`); else t.note(`${url} is not in this version: skipped`); continue; }
    let page;
    try {
      page = await t.open(url);
      await t.sleep(1500); await page.settle(1500, 25000);
      const title = await page.eval('document.title'), csp = await page.csp();
      const own = page.requests.filter(r => r.from !== 'page').length;
      t.check(`${url} loads`, 'the page answers and has a title', !!title, `“${title}” · ${page.requests.length} requests (${own} from workers)`);
      t.check(`${url} console`, 'no errors in the console', page.errors.length === 0, page.errors.length ? page.errors.slice(0, 4) : 'clean');
      t.check(`${url} content policy`, 'nothing refused by the Content-Security-Policy', csp.length === 0, csp.length ? csp.slice(0, 4) : 'nothing refused');
      t.check(`${url} requests`, 'no request fails or answers 4xx/5xx', page.failed.length === 0, page.failed.length ? page.failed.slice(0, 4) : 'all answered');
      t.private(page, `${url} stays on this computer`);
    } catch (e) { t.check(`${url} loads`, 'the page loads', false, e.message); }
    if (page) await page.close();
  }
}
