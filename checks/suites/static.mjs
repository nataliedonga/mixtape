// Checks that need no browser: no web address in the shipped code, every file a page names exists, and the offline
// cache's version matches the list of changes.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { readSw } from './sw.mjs';

export const needsBrowser = false;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKIP_DIRS = new Set(['.git', '_test', 'checks', 'docs', 'node_modules']);
const THIRD_PARTY = ['vendor/', 'stems/demucs/', 'stems/ort/'];        // other people's libraries: their web addresses are compared with a known list
const NOT_SHIPPED = /(^|\/)(check\.mjs|[\w-]+-check\.(cjs|mjs|js))$/;   // the node suites
const CODE = /\.(html|js|mjs|css)$/i;
const URL_RE = /\bhttps?:\/\/[^\s"'`<>)\\]*/g;
// Names, never fetched: xmlns and other W3C constants, and the namespace names a Word document (.docx) must carry inside
// its XML (transcribe/exportdoc.js writes them into the file; nothing is requested from them).
const W3C = /^https?:\/\/(www\.w3\.org|schemas\.openxmlformats\.org)\//;
// The one address Mixtape may reach, by her choice (2026-11-26): Anthropic's API, from the Transcripts page only, for
// Claude setting speakers and notations with her own key (transcribe/claude.js). It is allowed in that page's
// Content-Security-Policy and nowhere else.
// References that are known to point at nothing here, each with its reason. Anything else that is missing fails.
const EXPECTED_MISSING = [
  { file: 'cutter/app.js', ref: 'sw.js', why: 'only reached in the standalone Cutter (never when Mixtape hosts it), which has a service worker of its own' },
];

function walk(root, dir = '', out = []) {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir + e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(root, rel + '/', out); } else out.push(rel);
  }
  return out;
}

// Comments blanked out (same length, same lines), so what is left is code and strings.
const blank = s => s.replace(/[^\n]/g, ' ');
export function stripCss(s) { return s.replace(/\/\*[\s\S]*?\*\//g, blank); }
export function stripHtml(s) { return s.replace(/<!--[\s\S]*?-->/g, blank).replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, b, c) => a + stripCss(b) + c); }
const REGEX_AFTER = new Set(['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'void', 'delete', 'throw', 'new', 'yield', 'await', 'instanceof']);
export function stripJs(s) {
  const n = s.length; let i = 0, out = '', last = '', word = '';
  const emit = ch => { out += ch; if (/\s/.test(ch)) return; if (/[\w$]/.test(ch)) word = /[\w$]/.test(last) ? word + ch : ch; else word = ''; last = ch; };
  const str = q => { emit(s[i++]); while (i < n && s[i] !== q) { if (s[i] === '\\') out += s[i++]; if (s[i] === '\n' && q !== '`') break; out += s[i++]; } if (i < n && s[i] === q) emit(s[i++]); };
  function code(inTemplate) {
    let depth = 0;
    while (i < n) {
      const c = s[i], d = s[i + 1];
      if (c === '/' && d === '/') { const e = s.indexOf('\n', i), to = e < 0 ? n : e; out += blank(s.slice(i, to)); i = to; }
      else if (c === '/' && d === '*') { const e = s.indexOf('*/', i + 2), to = e < 0 ? n : e + 2; out += blank(s.slice(i, to)); i = to; }
      else if (c === '"' || c === "'") str(c);
      else if (c === '`') { emit(s[i++]); while (i < n && s[i] !== '`') { if (s[i] === '\\') { out += s[i++]; out += s[i++]; } else if (s[i] === '$' && s[i + 1] === '{') { out += '${'; i += 2; code(true); } else out += s[i++]; } if (i < n) emit(s[i++]); }
      else if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || (word && REGEX_AFTER.has(word)))) { // a regular expression
        emit(s[i++]); let cls = false;
        while (i < n && s[i] !== '\n') { if (s[i] === '\\') { out += s[i++]; out += s[i++]; continue; } if (s[i] === '[') cls = true; else if (s[i] === ']') cls = false; else if (s[i] === '/' && !cls) break; out += s[i++]; }
        if (s[i] === '/') { out += s[i++]; last = ')'; word = ''; } // what follows a regular expression is like what follows a value
      }
      else if (c === '{') { depth++; emit(s[i++]); }
      else if (c === '}') { if (inTemplate && depth === 0) { out += s[i++]; return; } depth--; emit(s[i++]); }
      else emit(s[i++]);
    }
  }
  code(false);
  return out;
}
const strip = (rel, s) => /\.html$/i.test(rel) ? stripHtml(s) : /\.css$/i.test(rel) ? stripCss(s) : stripJs(s);
const lineOf = (s, at) => s.slice(0, at).split('\n').length;

export async function run(t) {
  const files = walk(t.root), code = files.filter(f => CODE.test(f) && !NOT_SHIPPED.test(f));
  const ours = code.filter(f => !THIRD_PARTY.some(p => f.startsWith(p))), theirs = files.filter(f => THIRD_PARTY.some(p => f.startsWith(p)) && (CODE.test(f) || /\.js\.gz$/.test(f)));

  // 1. Mixtape's own code names no web address (outside comments and W3C constants)
  //    One address is allowed, by her choice (2026-11-26): Anthropic's API, in the Transcripts page's Content-Security-Policy
  //    only, for Claude setting speakers and notations with her own key (transcribe/claude.js).
  const hits = [], stripped = new Map();
  for (const f of ours) {
    const s = strip(f, fs.readFileSync(path.join(t.root, f), 'utf8')); stripped.set(f, s);
    for (const m of s.matchAll(URL_RE)) if (!W3C.test(m[0]) && !(f === 'transcribe/index.html' && /^https:\/\/api\.anthropic\.com;?$/.test(m[0]))) hits.push(`${f}:${lineOf(s, m.index)} ${m[0].slice(0, 80)}`);
  }
  t.check('no web address in Mixtape’s own code', 'no http(s):// in any shipped HTML, JS or CSS outside comments and W3C constants (xmlns)', hits.length === 0, hits.length ? hits.slice(0, 8) : `${ours.length} files clean`);

  // 2. the libraries in vendor/ and stems/: their web addresses (error-message links, defaults Mixtape overrides) are
  //    compared with the list written down when they were last looked at; a new one means a library changed
  const knownFile = path.join(HERE, '..', 'known-vendor-urls.json'), known = fs.existsSync(knownFile) ? JSON.parse(fs.readFileSync(knownFile, 'utf8')).hosts : null, found = new Map();
  for (const f of theirs) {
    let s; try { s = /\.gz$/.test(f) ? zlib.gunzipSync(fs.readFileSync(path.join(t.root, f))).toString('utf8') : fs.readFileSync(path.join(t.root, f), 'utf8'); } catch (e) { continue; }
    for (const m of s.matchAll(URL_RE)) { const h = (/^https?:\/\/([A-Za-z0-9.-]+)/.exec(m[0]) || [])[1]; if (h && !W3C.test(m[0])) { if (!found.has(h)) found.set(h, f); } }
  }
  if (process.env.WRITE_KNOWN) { fs.writeFileSync(knownFile, JSON.stringify({ note: 'Hosts named inside the third-party libraries in vendor/ and stems/ (links in error messages, defaults Mixtape overrides). The static check fails when a host appears that is not listed here. Rewrite with: WRITE_KNOWN=1 node checks/run.mjs static', hosts: [...found.keys()].sort() }, null, 1) + '\n'); t.note(`wrote ${found.size} hosts to known-vendor-urls.json`); }
  else {
    const fresh = known ? [...found].filter(([h]) => !known.includes(h)).map(([h, f]) => `${h} (in ${f})`) : ['known-vendor-urls.json is missing'];
    t.check('no new web address in the libraries', 'every host named in vendor/ and stems/ libraries is on the known list (checks/known-vendor-urls.json)', fresh.length === 0, fresh.length ? fresh.slice(0, 8) : `${found.size} hosts in ${theirs.length} files, all known`);
  }

  // 3. every file a page or script names exists
  const exists = p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
  const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } };
  const target = (dir, ref) => { const clean = ref.split('#')[0].split('?')[0]; if (!clean) return null; const p = path.join(t.root, dir, clean); return clean.endsWith('/') || isDir(p) ? path.join(p, 'index.html') : p; };
  const skipRef = r => !r || /^(#|data:|blob:|mailto:|javascript:|about:|https?:|\/)/i.test(r) || r.includes('${');
  const broken = [], loaders = new Map(); let count = 0, apis = 0, expected = 0;
  for (const f of ours.filter(f => /\.html$/i.test(f))) {
    const s = stripped.get(f), dir = path.posix.dirname(f);
    for (const m of s.matchAll(/<(script|link|img|a|source|audio|video|iframe)\b[^>]*?\s(src|href)\s*=\s*["']([^"']*)["']/gi)) {
      const ref = m[3]; if (/^\//.test(ref)) apis++; if (skipRef(ref)) continue; count++;
      const p = target(dir, ref); if (!p || !exists(p)) broken.push(`${f}:${lineOf(s, m.index)} ${m[1]} ${m[2]}="${ref}"`);
      else if (m[1].toLowerCase() === 'script') { const rel = path.relative(t.root, p).split(path.sep).join('/'); if (!loaders.has(rel)) loaders.set(rel, new Set()); loaders.get(rel).add(dir); }
    }
  }
  const JS_REFS = [/\bfetch\(\s*(['"])([^'"\n]+)\1/g, /\bnew (?:Shared)?Worker\(\s*(['"])([^'"\n]+)\1/g, /\bimportScripts\(\s*(['"])([^'"\n]+)\1/g, /\bimport\(\s*(['"])([^'"\n]+)\1/g, /\bfrom\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g, /\bimport\s*(['"])(\.{1,2}\/[^'"\n]+)\1/g, /\.addModule\(\s*(['"])([^'"\n]+)\1/g, /serviceWorker\.register\(\s*(['"])([^'"\n]+)\1/g, /\bnew URL\(\s*(['"])([^'"\n]+)\1\s*,\s*(?:import\.meta\.url|self\.location|location)/g];
  for (const f of ours.filter(f => /\.m?js$/i.test(f))) {
    const s = stripped.get(f), own = path.posix.dirname(f), dirs = [own, ...(loaders.get(f) || [])]; // a classic script's addresses are read from the page that loads it
    for (const re of JS_REFS) for (const m of s.matchAll(re)) {
      const ref = m[2]; if (/^\//.test(ref)) apis++; if (skipRef(ref)) continue; count++;
      const isImport = /^(\bfrom|\bimport)/.test(m[0]) || /^import\(/.test(m[0]) || /new URL/.test(m[0]);
      const joined = /^\s*\+/.test(s.slice(m.index + m[0].length, m.index + m[0].length + 4)); // 'orch/' + name: only the start of an address
      if (joined && !ref.endsWith('/')) continue;
      const folder = ref.endsWith('/') && (joined || /new URL/.test(m[0])); // a folder that addresses are built from: the folder must exist
      const ok = (isImport ? [own] : dirs).some(d => { if (folder) return isDir(path.join(t.root, d, ref)); const p = target(d, ref); return p && exists(p); });
      if (!ok && EXPECTED_MISSING.some(x => x.file === f && x.ref === ref)) { expected++; continue; }
      if (!ok) broken.push(`${f}:${lineOf(s, m.index)} ${m[0].slice(0, 70)}`);
    }
  }
  t.check('every named file exists', 'each <script src>, <link href>, fetch(\'…\'), Worker, import and the like in shipped pages resolves to a file', broken.length === 0, broken.length ? broken.slice(0, 8) : `${count} references resolve${apis ? `; ${apis} server addresses starting with “/” not checked` : ''}${expected ? `; ${expected} known exception` : ''}`);

  // 4. the offline cache's version is the newest entry in the list of changes
  const cj = path.join(t.root, 'changes.json');
  if (!fs.existsSync(cj)) t.note('there is no changes.json in this version: the VERSION check is skipped');
  else {
    const { version } = readSw(t.root), sw = +(/(\d+)$/.exec(version || '') || [])[1];
    let newest = null, why = '';
    try {
      const j = JSON.parse(fs.readFileSync(cj, 'utf8')), list = Array.isArray(j) ? j : j.changes || j.versions || j.entries || j.releases || [];
      const nums = list.map(e => { const v = e && (e.version ?? e.v ?? e.id ?? e.name); const m = /(\d+)\s*$/.exec(String(v ?? '').replace(/^mixtape-/, '')); return m ? +m[1] : null; }).filter(x => x != null);
      newest = nums.length ? Math.max(...nums) : null; if (newest == null) why = 'no entry with a version number was found';
    } catch (e) { why = 'changes.json could not be read: ' + e.message; }
    t.check('VERSION matches changes.json', 'sw.js VERSION is the newest version in changes.json', newest != null && newest === sw, why || `sw.js v${sw}, changes.json newest v${newest}`);
  }
}
