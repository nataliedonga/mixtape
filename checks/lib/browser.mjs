// Drives a real browser (Edge, else Chrome) through the Chrome DevTools Protocol over Node's own WebSocket.
// No Playwright, no Puppeteer, nothing to install. The browser gets a profile folder of its own, made for this run.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function findBrowser() {
  const local = process.env.LOCALAPPDATA || '';
  const list = [process.env.BROWSER,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', local && path.join(local, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const hit = list.find(p => fs.existsSync(p));
  if (!hit) throw new Error('No browser found. Set BROWSER to the path of Edge or Chrome.');
  return hit;
}

// What every page gets before its own scripts run: files the page "downloads" are kept in the page instead of being
// written to disk, and anything the page's Content-Security-Policy refuses is written down.
const PAGE_HOOKS = `(() => {
  if (window.__chk) return;
  const chk = window.__chk = { dl: [], csp: [], blobs: new Map() };
  const make = URL.createObjectURL.bind(URL);
  URL.createObjectURL = o => { const u = make(o); if (o instanceof Blob) { chk.blobs.set(u, o); if (chk.blobs.size > 300) chk.blobs.delete(chk.blobs.keys().next().value); } return u; };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) { chk.dl.push({ name: this.download, href: this.href, blob: chk.blobs.get(this.href) || null }); return; } return click.call(this); };
  document.addEventListener('securitypolicyviolation', e => chk.csp.push(e.violatedDirective + ' refused ' + (e.blockedURI || 'inline')));
})();`;

const KEYS = {
  ' ': { code: 'Space', vk: 32, text: ' ' }, Enter: { code: 'Enter', vk: 13, text: '\r' }, Tab: { code: 'Tab', vk: 9 }, Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 }, Delete: { code: 'Delete', vk: 46 }, Home: { code: 'Home', vk: 36 }, End: { code: 'End', vk: 35 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 }, ArrowUp: { code: 'ArrowUp', vk: 38 }, ArrowRight: { code: 'ArrowRight', vk: 39 }, ArrowDown: { code: 'ArrowDown', vk: 40 },
};
function keyInfo(key) {
  if (KEYS[key]) return { key, ...KEYS[key] };
  if (/^[a-z]$/i.test(key)) return { key, code: 'Key' + key.toUpperCase(), vk: key.toUpperCase().charCodeAt(0), text: key };
  if (/^[0-9]$/.test(key)) return { key, code: 'Digit' + key, vk: key.charCodeAt(0), text: key };
  return { key, code: '', vk: 0, text: key };
}

export async function launch({ profileDir, headed = false }) {
  const exe = findBrowser(), port = await freePort();
  const args = [`--user-data-dir=${profileDir}`, `--remote-debugging-port=${port}`, '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--window-size=1440,900', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--disable-extensions', '--disable-popup-blocking',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=Translate,msEdgeFirstRunExperience,OptimizationHints',
    // names other than this computer's own address do not resolve at all: if a page did try to reach another server, the
    // attempt is seen (and fails the check) but nothing leaves this computer
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
    ...(headed ? [] : ['--headless=new']), 'about:blank'];
  const proc = spawn(exe, args, { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 80 && !ver; i++) { await sleep(250); ver = await fetch(`http://127.0.0.1:${port}/json/version`).then(r => r.json()).catch(() => null); }
  if (!ver) { try { proc.kill(); } catch (e) {} throw new Error(`The browser did not start (${exe}).`); }
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('Could not connect to the browser.')); });
  let id = 0; const waits = new Map(), listeners = new Map(); // listeners: sessionId ('' = the browser itself) -> fn(method, params)
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id) { const w = waits.get(m.id); if (!w) return; waits.delete(m.id); if (m.error) w[1](new Error(`${w[2]}: ${m.error.message}`)); else w[0](m.result); return; }
    const fn = listeners.get(m.sessionId || ''); if (fn) { try { fn(m.method, m.params || {}); } catch (err) {} }
  };
  ws.onclose = () => { for (const w of waits.values()) w[1](new Error('the browser closed')); waits.clear(); };
  const cdp = (method, params = {}, sessionId) => new Promise((res, rej) => { if (ws.readyState !== 1) return rej(new Error('the browser closed')); waits.set(++id, [res, rej, method]); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
  // a file a page tries to download is never written anywhere (the checks read downloads inside the page instead)
  await cdp('Browser.setDownloadBehavior', { behavior: 'deny' }).catch(() => {});
  const browser = {
    name: ver.Browser, exe, cdp, listeners,
    async newPage(origin) { const p = new Page(browser, origin); await p.init(); return p; },
    async close() {
      const gone = new Promise(r => proc.once('exit', r));
      await Promise.race([cdp('Browser.close').catch(() => {}), sleep(3000)]);
      await Promise.race([gone, sleep(5000)]);
      try { proc.kill(); } catch (e) {}
      try { ws.close(); } catch (e) {}
      await sleep(300);
    },
    kill() { try { proc.kill(); } catch (e) {} },
  };
  return browser;
}

const short = u => { try { const x = new URL(u); return x.pathname + x.search; } catch (e) { return String(u).slice(0, 120); } };

export class Page {
  constructor(browser, origin) {
    this.b = browser; this.origin = origin; this.sessions = new Set();
    this.requests = []; this.outside = []; this.failed = []; this.errors = []; this.dialogs = []; this.urls = new Map(); this.lastRequestAt = Date.now();
  }
  async init() {
    const { targetId } = await this.b.cdp('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.b.cdp('Target.attachToTarget', { targetId, flatten: true });
    this.targetId = targetId; this.sid = sessionId;
    this.listen(sessionId, 'page');
    const c = (m, p) => this.b.cdp(m, p, sessionId);
    await c('Page.enable'); await c('Runtime.enable'); await c('Network.enable'); await c('Log.enable');
    // workers and service workers are held at their first line until their requests are being watched too
    await c('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    await c('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HOOKS });
    await c('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await c('Page.bringToFront').catch(() => {});
  }
  // a script that runs in every page of this tab before the page's own (for example to switch a file picker off)
  async preload(source) { await this.b.cdp('Page.addScriptToEvaluateOnNewDocument', { source }, this.sid); }
  listen(sid, kind) {
    this.sessions.add(sid);
    this.b.listeners.set(sid, (method, p) => {
      if (method === 'Target.attachedToTarget') { // a worker of this page (or a worker's worker)
        const child = p.sessionId, type = p.targetInfo.type; this.listen(child, type);
        const c = (m, q) => this.b.cdp(m, q, child).catch(() => {});
        c('Network.enable'); c('Runtime.enable'); c('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }); c('Runtime.runIfWaitingForDebugger');
      } else if (method === 'Target.detachedFromTarget') { this.b.listeners.delete(p.sessionId); this.sessions.delete(p.sessionId); }
      else if (method === 'Network.requestWillBeSent') {
        const url = p.request.url; this.urls.set(p.requestId, url); this.lastRequestAt = Date.now(); this.requests.push({ url, from: kind });
        if (!this.isOwn(url)) this.outside.push(`${url.slice(0, 200)} (from the ${kind.replace('_', ' ')})`);
      } else if (method === 'Network.webSocketCreated') { this.requests.push({ url: p.url, from: kind }); if (!this.isOwn(p.url)) this.outside.push(`${p.url.slice(0, 200)} (a socket, from the ${kind})`); }
      else if (method === 'Network.loadingFailed') { const url = this.urls.get(p.requestId) || '?'; if (!p.canceled) this.failed.push(`${short(url)}: ${p.blockedReason ? 'blocked (' + p.blockedReason + ')' : p.errorText}`); }
      else if (method === 'Network.responseReceived') { if (p.response.status >= 400) this.failed.push(`${short(p.response.url)}: answered ${p.response.status}`); }
      else if (method === 'Runtime.exceptionThrown') { const d = p.exceptionDetails; this.errors.push(`uncaught: ${String((d.exception && d.exception.description) || d.text).split('\n')[0].slice(0, 300)}`); }
      else if (method === 'Runtime.consoleAPICalled') { if (p.type === 'error' || p.type === 'assert') this.errors.push(`console.error: ${p.args.map(a => a.value ?? a.description ?? a.type).join(' ').split('\n')[0].slice(0, 300)}`); }
      else if (method === 'Log.entryAdded') { if (p.entry.level === 'error') this.errors.push(`${p.entry.source}: ${p.entry.text.slice(0, 300)}${p.entry.url ? ' (' + short(p.entry.url) + ')' : ''}`); }
      else if (method === 'Page.javascriptDialogOpening') { this.dialogs.push(`${p.type}: ${p.message.slice(0, 200)}`); this.b.cdp('Page.handleJavaScriptDialog', { accept: true }, this.sid).catch(() => {}); }
    });
  }
  isOwn(url) {
    if (/^(data|blob|about):/i.test(url)) return true;
    try { const u = new URL(url); return /^(https?|wss?):$/.test(u.protocol) && u.host === new URL(this.origin).host; } catch (e) { return false; }
  }
  async eval(expression) {
    const r = await this.b.cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, this.sid);
    if (r.exceptionDetails) throw new Error('in the page: ' + String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).split('\n')[0]);
    return r.result.value;
  }
  // run a function in the page with JSON arguments
  call(fn, ...args) { return this.eval(`(${fn})(${args.map(a => JSON.stringify(a)).join(',')})`); }
  async goto(pathOrUrl) {
    const url = /^https?:/.test(pathOrUrl) ? pathOrUrl : this.origin + pathOrUrl;
    const loaded = this.once('Page.loadEventFired', 30000); loaded.catch(() => {});
    const r = await this.b.cdp('Page.navigate', { url }, this.sid);
    if (r.errorText) throw new Error(`could not open ${url}: ${r.errorText}`);
    await loaded;
  }
  async reload() { const loaded = this.once('Page.loadEventFired', 30000); loaded.catch(() => {}); await this.b.cdp('Page.reload', { ignoreCache: true }, this.sid); await loaded; }
  once(method, ms) {
    return new Promise((res, rej) => {
      const prev = this.b.listeners.get(this.sid), t = setTimeout(() => { this.b.listeners.set(this.sid, prev); rej(new Error(`waited ${ms / 1000} s for ${method}`)); }, ms);
      this.b.listeners.set(this.sid, (m, p) => { prev(m, p); if (m === method) { clearTimeout(t); this.b.listeners.set(this.sid, prev); res(p); } });
    });
  }
  // wait until an expression in the page is truthy; returns its value
  async waitFor(expression, ms = 15000, what = expression) {
    const t0 = Date.now(); let err;
    for (;;) {
      try { const v = await this.eval(expression); err = null; if (v) return v; } catch (e) { err = e; }
      if (Date.now() - t0 > ms) throw new Error(`waited ${Math.round(ms / 1000)} s for: ${what}${err ? ' (' + err.message + ')' : ''}`);
      await sleep(100);
    }
  }
  // wait until the page has stopped asking for files
  async settle(quiet = 1200, max = 20000) { const t0 = Date.now(); while (Date.now() - this.lastRequestAt < quiet && Date.now() - t0 < max) await sleep(100); }
  // a real mouse click in the middle of an element. target: a CSS selector, or { js: 'an expression giving the element', name }
  async click(target) {
    const expr = typeof target === 'string' ? `document.querySelector(${JSON.stringify(target)})` : target.js, name = typeof target === 'string' ? target : target.name || target.js;
    const p = await this.eval(`(() => { const el = ${expr}; if (!el) return { err: 'is not on the page' };
      let r = el.getBoundingClientRect(); // scrolled into view only when it is not already there (as a person would)
      if (r.width && r.height && (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth)) { el.scrollIntoView({ block: 'center', inline: 'center' }); r = el.getBoundingClientRect(); } if (!r.width || !r.height) return { err: 'is not visible' }; if (el.disabled) return { err: 'is disabled' };
      const x = r.left + r.width / 2, y = r.top + r.height / 2; let top = document.elementFromPoint(x, y);
      for (let n = 0; n < 8 && top && top.shadowRoot; n++) { const inner = top.shadowRoot.elementFromPoint(x, y); if (!inner || inner === top) break; top = inner; }
      const holds = (a, b) => { for (let n = b; n; n = n.parentNode || n.host) if (n === a) return true; return false; };
      if (!top || !holds(el, top)) return { err: 'is covered by ' + (top ? '<' + top.tagName.toLowerCase() + (top.id ? '#' + top.id : '') + (typeof top.className === 'string' && top.className ? '.' + top.className.trim().split(' ').filter(Boolean).join('.') : '') + '> “' + (top.textContent || '').trim().slice(0, 60) + '”' : 'nothing') };
      return { x, y }; })()`);
    if (p.err) throw new Error(`cannot click ${name}: it ${p.err}`);
    const m = (type, extra = {}) => this.b.cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1, ...extra }, this.sid);
    await m('mouseMoved', { button: 'none' }); await m('mousePressed'); await m('mouseReleased'); await sleep(60);
  }
  // a real mouse drag between two points of the window (for example across a line of text)
  async drag(x1, y1, x2, y2, steps = 12) {
    const m = (type, x, y, extra = {}) => this.b.cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: 1, clickCount: 1, ...extra }, this.sid);
    await m('mouseMoved', x1, y1, { button: 'none', buttons: 0 }); await m('mousePressed', x1, y1);
    for (let i = 1; i <= steps; i++) { await m('mouseMoved', x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps); await sleep(15); }
    await m('mouseReleased', x2, y2, { buttons: 0 }); await sleep(80);
  }
  // click the first visible button, menu item or link inside `scope` whose text contains `text`
  clickText(scope, text) { return this.click({ name: `“${text}” in ${scope}`, js: `[...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} [role=menuitem], ${scope} a`)})].find(b => b.textContent.includes(${JSON.stringify(text)}) && b.getBoundingClientRect().width > 0)` }); }
  // a real key press. mods: { ctrl, shift, alt }
  async press(key, mods = {}) {
    const k = keyInfo(key), modifiers = (mods.alt ? 1 : 0) | (mods.ctrl ? 2 : 0) | (mods.shift ? 8 : 0), typed = k.text && !mods.ctrl && !mods.alt;
    const base = { key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers };
    await this.b.cdp('Input.dispatchKeyEvent', { type: typed ? 'keyDown' : 'rawKeyDown', ...base, ...(typed ? { text: k.text, unmodifiedText: k.text } : {}) }, this.sid);
    await this.b.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, this.sid); await sleep(40);
  }
  async type(text) { for (const ch of text) await this.press(ch); }
  // put real files (paths on disk, inside this run's temp folder) into a file input, as picking them would
  async setFiles(selector, paths) {
    const r = await this.b.cdp('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})` }, this.sid);
    if (!r.result.objectId) throw new Error(`no file input ${selector} on the page`);
    await this.b.cdp('DOM.setFileInputFiles', { files: paths, objectId: r.result.objectId }, this.sid);
  }
  // what the page's Content-Security-Policy refused
  csp() { return this.eval('window.__chk ? window.__chk.csp.slice() : []').catch(() => []); }
  async close() { for (const s of this.sessions) this.b.listeners.delete(s); await this.b.cdp('Target.closeTarget', { targetId: this.targetId }).catch(() => {}); }
}
