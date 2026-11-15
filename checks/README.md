# Mixtape pre-release check

One command opens every tool in a real browser and does the basics, so an update cannot quietly break something.

```
node checks/run.mjs                  everything (about a minute)
node checks/run.mjs cutter reader    only those checks
HEADED=1 node checks/run.mjs         watch the browser do it
FULL=1 node checks/run.mjs           also transcribe a clip end to end with the bundled recogniser (about a minute more)
```

Each line of the output is one check: `PASS` or `FAIL`, what was wanted, and what was seen. The run ends with a count
and exits with 1 if anything failed.

Checks, in the order they run: `static`, `node`, `pages`, `sw`, `player`, `cutter`, `transcripts`, `studio`, `reader`.

## What it needs

Node 22 or newer (it uses Node's own WebSocket), Edge or Chrome, and ffmpeg on the PATH. Nothing to install: there is
no `package.json` and no Playwright or Puppeteer. The browser is driven through the Chrome DevTools Protocol
(`lib/browser.mjs`). `BROWSER=<path>` chooses another Chromium browser.

## What it covers

| Check | What it does |
|---|---|
| `static` | No `http(s)://` address in Mixtape's own HTML, JS or CSS outside comments and W3C constants. The hosts named inside the libraries in `vendor/` and `stems/` are compared with `known-vendor-urls.json`. Every `<script src>`, `<link href>`, `fetch('…')`, `Worker`, `import` and the like resolves to a file. `sw.js` VERSION is the newest entry of `changes.json`. |
| `node` | `node cutter/check.mjs`, `node lyrics-check.cjs` and `node transcript-check.cjs` still pass. |
| `pages` | `/`, `/studio.html`, `/cutter/`, `/transcribe/`, `/reader/` (and `/home/`, `/storage/` when they exist) load as a first-time visitor with no console errors, nothing refused by the Content-Security-Policy, no failed request, and **no request to any host but the test server**, from the page or its workers. It first proves the watcher works by making an outside request on purpose. |
| `sw` | The service worker installs on the test server; its `mixtape-v<n>` cache holds every file on the CORE list; every CORE file is on disk; `scanline-test` and `mixtape-speaker-v1` survive activation; an old `mixtape-v1` is cleared. |
| `player` | Add two songs; they appear; a clicked song plays; Space pauses; make a playlist and put a song in it; reload: both are still there and a stored song plays. |
| `cutter` | Open a clip; mark 1 s to 3 s with the keys; exact cut to WAV is 2.000 s within 5 ms; join a WAV, an MP3 and an M4A: the length is the sum; a video with AC-3 sound is refused on an exact cut with the "cannot decode" message; the untouched copy works. |
| `transcripts` | A recording and its words open together; a click on a word plays from its time; Back is 10 s, Forward is 5 s; a recording imported with `"sensitive": true` is locked (AI check disabled) and every file saved from it is named `(SENSITIVE)` and says so inside; the mark survives a reload. `FULL=1`: 20 s is transcribed with the recogniser from `vendor/asr/` and no outside request. |
| `studio` | Boots with a mix; a library song goes onto a track; it plays and Space pauses; "Save this mix as a file" gives JSON with `format: 'mixtape.studio-mix'`; a short mix exports to a WAV that is not silent; the mix is there after a reload. |
| `reader` | The checks' own two-page PDF opens and shows its page count; a highlight is made with a real mouse drag; "Save a copy…" gives a PDF with the highlight in it; the copy re-opens with the highlight. The same for `_test/ebook.pdf` when it is there. |

Every tool check also ends with "nothing asked of another server" for the whole flow.

## Safety

- The browser runs with a profile folder of its own, and the run has a work folder of its own. Both are made fresh in
  the system temp folder (`mixtape-checks-profile-…`, `mixtape-checks-work-…`) and are the only two things deleted at
  the end. `run.mjs` refuses to delete any folder it did not make in that run.
- Your own browser profiles, your Downloads and the files in this repository are never written to.
- Files the pages would download are read inside the page (the Cutter's `window.__cutterSave` hook; elsewhere the
  download link's click is caught). The browser is also told to refuse downloads, so nothing can land in Downloads.
- The browser is started so that no name other than this computer resolves. If a page did try to reach another
  server the attempt is seen (and fails the check) but goes nowhere.
- Each check gets a test server on a port of its own, so what one check stores (songs, playlists, the offline cache)
  cannot reach another.

## How it is put together

```
run.mjs               starts the browser and the servers, runs the checks, prints the results, cleans up
lib/server.mjs        static server: byte ranges, Cache-Control: no-store
lib/browser.mjs       the browser: tabs, real clicks, real key presses, real mouse drags, file inputs,
                      and a watch on every request of the page and its workers
lib/media.mjs         the test sound and video, made with ffmpeg into the temp folder
lib/inpage.mjs        small pieces that run inside the page (a WAV reader, the "been here before" flags)
suites/<name>.mjs     one file per check; one broken tool does not stop the others
fixtures/             small fixed files: two transcripts and a two-page PDF (written by make-fixtures.mjs)
known-vendor-urls.json  hosts named inside the third-party libraries (WRITE_KNOWN=1 node checks/run.mjs static rewrites it)
```

Adding a check: in a suite, `t.check(name, what is wanted, passed, what was seen)`. State what is wanted before looking.
A new suite is a file in `suites/` that exports `needsBrowser` and `run(t)`, plus its name in `SUITES` in `run.mjs`.

## Good to know

- The tools' test hooks (`window.__player`, `__cutter`, `__tr`, `__studio`, `__reader`) only exist on `localhost` and
  `127.0.0.1`. The checks use them to read state; the actions are real clicks and key presses wherever the check is
  about clicking or keys.
- The tool checks run as a visitor who has been here before (the first-run welcome is already answered), so the
  welcome does not sit over the controls. The `pages` check loads every page as a first-time visitor.
- In Transcripts the AI-check button only exists where there is a studio server. The check gives the page an address
  on the test server (never called) so the button is there to be locked.
- In the Reader the system's save window is switched off for the check, so "Save a copy…" falls back to a download
  that is read inside the page.
- A check that fails because a file is half-edited will say which page error it saw.
