// A small static server for the checks: serves the Mixtape folder on a free 127.0.0.1 port, with byte ranges and no caching.
// Each check gets a server of its own (its own port, so its own site address): what one check stores cannot reach another.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.mp4': 'video/mp4', '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8', '.gz': 'application/gzip', '.onnx': 'application/octet-stream',
};
const BLANK = '<!doctype html><meta charset="utf-8"><title>blank page for the checks</title>';

export function startServer(root) {
  root = path.resolve(root);
  const seen = [];
  const server = http.createServer((q, s) => {
    let p; try { p = decodeURIComponent(q.url.split('?')[0].split('#')[0]); } catch (e) { s.writeHead(400); return s.end(); }
    seen.push(p);
    const base = { 'cache-control': 'no-store', 'accept-ranges': 'bytes' };
    if (p === '/__blank') { s.writeHead(200, { ...base, 'content-type': TYPES['.html'] }); return s.end(BLANK); }
    let f = path.join(root, p);
    if (f !== root && !f.startsWith(root + path.sep)) { s.writeHead(403); return s.end(); }
    if (p.split('/').includes('.git')) { s.writeHead(404); return s.end(); }
    let st; try { st = fs.statSync(f); } catch (e) { s.writeHead(404, base); return s.end('not found'); }
    if (st.isDirectory()) {
      if (!p.endsWith('/')) { s.writeHead(301, { ...base, location: p + '/' }); return s.end(); }
      f = path.join(f, 'index.html'); try { st = fs.statSync(f); } catch (e) { s.writeHead(404, base); return s.end('not found'); }
    }
    const size = st.size, type = TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', m = /bytes=(\d*)-(\d*)/.exec(q.headers.range || '');
    if (m && (m[1] || m[2])) {
      const a = m[1] ? +m[1] : Math.max(0, size - +m[2]), b = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (a >= size || a > b) { s.writeHead(416, { ...base, 'content-range': `bytes */${size}` }); return s.end(); }
      s.writeHead(206, { ...base, 'content-type': type, 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1 });
      if (q.method === 'HEAD') return s.end();
      return fs.createReadStream(f, { start: a, end: b }).on('error', () => s.destroy()).pipe(s);
    }
    s.writeHead(200, { ...base, 'content-type': type, 'content-length': size });
    if (q.method === 'HEAD') return s.end();
    fs.createReadStream(f).on('error', () => s.destroy()).pipe(s);
  });
  return new Promise((res, rej) => {
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      res({ port, origin: `http://127.0.0.1:${port}`, seen, close: () => new Promise(r => { if (server.closeAllConnections) server.closeAllConnections(); server.close(() => r()); }) });
    });
  });
}
