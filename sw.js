// Mixtape offline cache. Bump VERSION whenever app files change so installed copies pick up the new version.
const VERSION = 'mixtape-v109';
const CORE = ['./', './index.html', './app.js', './studio.html', './studio.js', './dsp-worker.js', './dsp-shared.js', './midi.js', './long-mp3.js', './media-cut.js', './vendor/mediabunny/mediabunny.min.mjs', './lofi-worklet.js', './vendor/tone/Tone.js', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './cutter/', './cutter/index.html', './cutter/app.js', './cutter/engine.js', './cutter/model.js', './cutter/h264.js', './cutter/style.css', './cutter/host-mixtape.js', './cutter/olddecode.js', './vendor/libav/libav-6.10.9.0-cutter-oldaudio.mjs', './vendor/libav/libav-6.10.9.0-cutter-oldaudio.wasm.mjs', './vendor/libav/libav-6.10.9.0-cutter-oldaudio.wasm.wasm',
  './lyrics-core.js', './lyrics.js', './lyrics.css', './asr-worker.js', './speaker-worker.js',
  './transcript-core.js', './transcribe/', './transcribe/index.html', './transcribe/app.js', './transcribe/style.css', './transcribe/reverb.js', './transcribe/reverb.css', './transcribe/follow.js', './transcribe/part.js', './transcribe/remove.js', './transcribe/roles.js', './transcribe/matter.js', './transcribe/exportas.js', './transcribe/exportdoc.js', './transcribe/tags.js', './tags-core.js', './style-core.js', './roles-core.js', './transcribe/remove.css', './transcribe/tidy.css', './transcribe/legal.js', './transcribe/legal-presets.js', './transcribe/legal.css', './legal-core.js',
  './reader/', './reader/index.html', './reader/app.js', './reader/style.css', './vendor/embedpdf/embedpdf.js', './vendor/embedpdf/embedpdf-cl9qiF45.js', './vendor/embedpdf/browser-BKLM0ThC-BCLQGPD6.js', './vendor/embedpdf/direct-engine-DVLMOJWp.js', './vendor/embedpdf/worker-engine-BCCrxWYm.js', './vendor/embedpdf/pdfium.wasm',
  './vendor/embedpdf/fonts/NotoSans-Regular.ttf', './vendor/embedpdf/fonts/NotoSans-Bold.ttf', './vendor/embedpdf/fonts/NotoSans-Italic.ttf', './vendor/embedpdf/fonts/NotoSans-BoldItalic.ttf',
  './reader/doc.css', './reader/textview.js', './reader/formats.js', './reader/sanitize.js', './reader/zip.js', './reader/pages.js', './reader/redact.js', './reader/ocr.js', './vendor/marked/marked.esm.js', './vendor/mammoth/mammoth.browser.min.js', './vendor/pdf-lib/pdf-lib.esm.min.js',
  './shell.js', './shell.css', './changes.json',
  './home/', './home/index.html', './home/home.css', './home/home.js', './storage/', './storage/index.html', './storage/storage.css', './storage/storage.js', './backup-core.js',
  './vendor/fonts/BricolageGrotesque-latin-11f6ab2d.woff2', './vendor/fonts/BricolageGrotesque-latin-ext-094ba9c3.woff2', './vendor/fonts/Figtree-latin-57fd1acf.woff2', './vendor/fonts/Figtree-latin-ext-a310474d.woff2', './vendor/fonts/IBMPlexMono-latin-50879063.woff2', './vendor/fonts/IBMPlexMono-latin-ac5ee02b.woff2', './vendor/fonts/IBMPlexMono-latin-d5549a5e.woff2', './vendor/fonts/IBMPlexMono-latin-ext-4a23f6b8.woff2', './vendor/fonts/IBMPlexMono-latin-ext-b058013d.woff2', './vendor/fonts/IBMPlexMono-latin-ext-e35bab18.woff2', './vendor/fonts/IBMPlexSans-latin-d8b4e62d.woff2', './vendor/fonts/IBMPlexSans-latin-ext-69ec3099.woff2', './vendor/fonts/JetBrainsMono-latin-4f27206c.woff2', './vendor/fonts/JetBrainsMono-latin-ext-06ad3600.woff2', './vendor/fonts/MartianMono-latin-b1337618.woff2', './vendor/fonts/MartianMono-latin-ext-f877caae.woff2', './vendor/fonts/Newsreader-latin-5d70b133.woff2', './vendor/fonts/Newsreader-latin-ext-a40c6200.woff2', './vendor/fonts/cutter.css', './vendor/fonts/player.css', './vendor/fonts/studio.css', './vendor/fonts/transcripts.css'];
// The AI stem splitter is large and changes rarely, so it lives in its own caches that app updates don't clear.
const STEMS_RUNTIME = 'mixtape-stems-runtime-v1';   // ONNX Runtime + splitter code, saved on first use
const LYRICS_RUNTIME = 'mixtape-lyrics-runtime-v2'; // the speech recogniser's library and runtime (transformers.js + ONNX Runtime, from vendor/asr/), saved on first use
// Only older copies of the app's own pages are cleared on an update. Everything else on this site address is left
// alone: the downloaded recognisers (speech, speakers, stems, orchestra), and other apps that share the address
// (Scanline lives beside Mixtape on the same GitHub Pages site, and each used to wipe the other's offline copy).
const KEEP = k => k === VERSION || !/^mixtape-v\d+$/.test(k);
const OCR_RUNTIME = 'mixtape-ocr-runtime-v1'; // the Reader's OCR engine and English data, saved on first use
const ORCH_CACHE = 'mixtape-orch-v1'; // the orchestra's recordings, saved on first use

self.addEventListener('install', e => {
  // cache: 'reload' skips the browser's own HTTP cache: GitHub Pages lets it keep files for 10 minutes, so a new version
  // installed soon after publishing could otherwise store the previous version's files
  // ...and the site's own delivery network can go on handing out the previous copy of a file for some minutes after a
  // release. A version that installed in that window kept a stale file (new page, old stylesheet) until the next release.
  // Asking for each file with the version in its address gets the newly published copy; it is stored under its plain name.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(CORE.map(async u => { const r = await fetch(new Request(u + (u.includes('?') ? '&' : '?') + 'v=' + VERSION, { cache: 'reload' })); if (!r.ok) throw new Error(u + ': ' + r.status); await c.put(u, r); }))));
});
// A new version waits until the page asks for it (the "Mixtape was updated: Reload" bar in shell.js) or every Mixtape
// tab has closed, so an open page never ends up running half old, half new. A first install still starts at once.
self.addEventListener('message', e => { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !KEEP(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Nothing is fetched from any other server: fonts and the speech recogniser are part of the app (vendor/).
  if (url.origin !== location.origin) return;
  const path = url.pathname;
  // The speech recogniser: its models are kept by the recogniser itself; its library and runtime (30 MB) are saved the
  // first time they are used, so transcripts and lyric timing also work offline later.
  // The Reader's text recogniser (OCR, 7 MB): saved the first time it is used, so scanned pages can also be read offline later.
  if (path.includes('/vendor/tesseract/')) {
    e.respondWith(caches.open(OCR_RUNTIME).then(async c => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
    return;
  }
  if (path.includes('/vendor/asr/models/')) return;
  if (path.includes('/vendor/asr/')) {
    e.respondWith(caches.open(LYRICS_RUNTIME).then(async c => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
    return;
  }
  // Orchestra recordings: saved the first time each one is used, so the orchestra also works offline.
  if (path.includes('/orch/') || path.includes('/piano/') || path.includes('/gm/') || path.includes('/drums/')) {
    e.respondWith(caches.open(ORCH_CACHE).then(async c => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
    return;
  }
  // The AI model is downloaded, checked and saved by the stem worker itself.
  if (path.includes('/stems/model/')) return;
  // Splitter runtime: save on first use so splitting also works offline later.
  if (path.includes('/stems/')) {
    e.respondWith(caches.open(STEMS_RUNTIME).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r;
    }));
    return;
  }
  // Pages: try the network for updates, fall back to the saved copy of that same page offline — and also when the site
  // answers with an error (a 404 after the GitHub account was renamed left the installed app showing "not found"
  // although its saved copy, and the songs, were still on the phone).
  if (req.mode === 'navigate') {
    const key = path.endsWith('studio.html') ? './studio.html' : path.includes('/cutter/') ? './cutter/index.html' : path.includes('/transcribe/') ? './transcribe/index.html' : path.includes('/reader/') ? './reader/index.html' : path.includes('/home/') ? './home/index.html' : path.includes('/storage/') ? './storage/index.html' : './index.html'; // offline, each page falls back to itself
    e.respondWith(fetch(req).then(async r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(key, copy)); return r; }
      return (await caches.match(key)) || r;
    }).catch(() => caches.match(key)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
