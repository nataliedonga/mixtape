/* A careful zip reader for documents that are zip files inside (.docx, .odt, .epub).
   A document is untrusted: a few kilobytes can claim to unpack into gigabytes (a "zip bomb"). So before anything is
   unpacked the list of contents is read and refused if it has too many entries or claims too much, and while
   unpacking every byte is counted against the same allowance, so a file that lies about its sizes is stopped too.
   Unpacking is the browser's own (DecompressionStream); there is no library here. */

export const LIMITS = { entries: 5000, total: 300 * 1024 * 1024, ratio: 200 };
export class Refused extends Error { constructor(m) { super(m); this.refused = true; } }

const mb = n => n >= 1048576 ? `${Math.round(n / 1048576)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const utf8 = new TextDecoder('utf-8');

async function inflate(bytes, allow) { // raw deflate, stopped the moment it passes `allow` bytes
  const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
  w.write(bytes).catch(() => {}); w.close().catch(() => {});
  const r = ds.readable.getReader(), parts = []; let n = 0;
  for (;;) {
    let step; try { step = await r.read(); } catch (e) { throw new Refused('This file is damaged: part of it could not be unpacked.'); }
    if (step.done) break;
    n += step.value.length;
    if (n > allow) { r.cancel().catch(() => {}); throw new Refused('It unpacks into far more than it says it holds, which is how a file built to fill up a computer behaves.'); }
    parts.push(step.value);
  }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* openZip(arrayBuffer) -> { names, has(name), bytes(name), text(name), size(name) }.  Throws Refused with a plain
   sentence when the file is not a zip, is locked, or is over the limits. */
export async function openZip(buffer, limits = LIMITS) {
  const u8 = new Uint8Array(buffer), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), N = u8.length;
  let eocd = -1;
  for (let i = N - 22; i >= Math.max(0, N - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Refused('This file is not what its name says: it should be a zip package inside and is not. It may be damaged or only partly downloaded.');
  const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdAt = dv.getUint32(eocd + 16, true);
  if (count === 0xFFFF || cdAt === 0xFFFFFFFF) throw new Refused('It is packed in a way meant for files over 4 GB, which no document needs.');
  if (count > limits.entries) throw new Refused(`It holds ${count.toLocaleString()} parts, and no ordinary document has more than ${limits.entries.toLocaleString()}. It may have been built to overload the computer.`);
  if (cdAt + cdSize > N) throw new Refused('This file is damaged: its list of contents points outside the file.');
  const entries = new Map(); let claimed = 0, p = cdAt;
  for (let k = 0; k < count; k++) {
    if (p + 46 > N || dv.getUint32(p, true) !== 0x02014b50) throw new Refused('This file is damaged: its list of contents cannot be read.');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), at = dv.getUint32(p + 42, true);
    const name = utf8.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + xl + cl;
    if (flags & 1) throw new Refused('This file is locked with a password. Open it in the program that made it, remove the password, and try again.');
    if (name.endsWith('/')) continue;
    claimed += usize;
    if (claimed > limits.total) throw new Refused(`It would unpack into more than ${mb(limits.total)}. It may have been built to fill up the computer (a "zip bomb").`);
    if (usize > 1048576 && csize > 0 && usize / csize > limits.ratio * 5) throw new Refused('One part of it is squeezed thousands of times smaller than it claims to be, which is how a file built to fill up a computer (a "zip bomb") looks.');
    entries.set(name, { method, csize, usize, at, data: null });
  }
  let spent = 0;
  async function bytes(name) {
    const e = entries.get(name); if (!e) return null;
    if (e.data) return e.data;
    if (e.at + 30 > N || dv.getUint32(e.at, true) !== 0x04034b50) throw new Refused('This file is damaged: one of its parts is not where the list of contents says.');
    const start = e.at + 30 + dv.getUint16(e.at + 26, true) + dv.getUint16(e.at + 28, true);
    if (start + e.csize > N) throw new Refused('This file is damaged: one of its parts runs past the end of the file.');
    const raw = u8.subarray(start, start + e.csize);
    if (e.method === 0) { e.data = raw; spent += raw.length; }
    else if (e.method === 8) { e.data = await inflate(raw, Math.min(e.usize, limits.total - spent)); spent += e.data.length; }
    else throw new Refused('This file is packed in a way this Reader does not read.');
    if (spent > limits.total) throw new Refused(`It unpacks into more than ${mb(limits.total)}.`);
    return e.data;
  }
  return {
    names: [...entries.keys()], has: n => entries.has(n), size: n => entries.get(n)?.usize ?? 0, bytes,
    text: async n => { const b = await bytes(n); return b ? utf8.decode(b) : null; },
  };
}

/* The same contents as a plain zip with nothing compressed, for a library that insists on unpacking for itself: it
   is handed only what was already unpacked and counted here. */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; };
export async function storedCopy(zip, keep = () => true) {
  const enc = new TextEncoder(), parts = [], cd = []; let at = 0;
  for (const name of zip.names) {
    if (!keep(name)) continue;
    const data = await zip.bytes(name), nm = enc.encode(name), crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x800, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x800, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, at, true);
    parts.push(new Uint8Array(lh.buffer), nm, data); cd.push(new Uint8Array(ch.buffer), nm); at += 30 + nm.length + data.length;
  }
  const cdSize = cd.reduce((s, b) => s + b.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, cd.length / 2, true); end.setUint16(10, cd.length / 2, true); end.setUint32(12, cdSize, true); end.setUint32(16, at, true);
  return await new Blob([...parts, ...cd, new Uint8Array(end.buffer)]).arrayBuffer();
}
