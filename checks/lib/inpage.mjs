// Pieces that run inside the page (sent as source text).

// A visitor who has been here before: the first-run welcome of each tool is already answered, so it does not sit over
// the controls being clicked. (The page-load check opens every page as a first-time visitor, welcome and all.)
export const RETURNING = `try {
  for (const t of ['player', 'studio', 'cutter', 'transcripts', 'reader']) localStorage.setItem('mixtape-welcome:' + t, 'done');
  if (!localStorage.getItem('mixtape-studio-ui')) localStorage.setItem('mixtape-studio-ui', JSON.stringify({ toured: true }));
} catch (e) {}`;

// Reads a WAV file (a Blob) without any decoder: its sample rate, channels, exact length and loudest sample (0..1).
export const WAV_INFO = `async blob => {
  const b = new DataView(await blob.arrayBuffer()), tag = o => String.fromCharCode(b.getUint8(o), b.getUint8(o + 1), b.getUint8(o + 2), b.getUint8(o + 3));
  if (b.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return { error: 'not a WAV file (' + blob.size + ' bytes, starts ' + (b.byteLength >= 4 ? tag(0) : '?') + ')' };
  let o = 12, fmt = null, data = null;
  while (o + 8 <= b.byteLength) { const id = tag(o), size = b.getUint32(o + 4, true); if (id === 'fmt ') fmt = o + 8; if (id === 'data') { data = { at: o + 8, size: Math.min(size, b.byteLength - o - 8) }; break; } o += 8 + size + (size & 1); }
  if (fmt == null || !data) return { error: 'the WAV has no sound chunk' };
  const kind = b.getUint16(fmt, true), ch = b.getUint16(fmt + 2, true), sr = b.getUint32(fmt + 4, true), bits = b.getUint16(fmt + 14, true), bytes = bits / 8, frames = Math.floor(data.size / (bytes * ch));
  const float = kind === 3 || (kind === 0xFFFE && b.getUint16(fmt + 24, true) === 3);
  let peak = 0; const n = frames * ch, step = Math.max(1, Math.floor(n / 400000));
  for (let i = 0; i < n; i += step) { const p = data.at + i * bytes; let v;
    if (float) v = bytes === 8 ? b.getFloat64(p, true) : b.getFloat32(p, true);
    else if (bytes === 1) v = (b.getUint8(p) - 128) / 128; else if (bytes === 2) v = b.getInt16(p, true) / 32768;
    else if (bytes === 3) v = ((b.getInt8(p + 2) << 16) | (b.getUint8(p + 1) << 8) | b.getUint8(p)) / 8388608; else v = b.getInt32(p, true) / 2147483648;
    if (Math.abs(v) > peak) peak = Math.abs(v); }
  return { sr, ch, bits, frames, seconds: frames / sr, peak: +peak.toFixed(4), bytes: blob.size };
}`;

// The length of any sound file the browser can decode (a Blob), in seconds, by decoding all of it.
export const DECODED_SECONDS = `async blob => { const ctx = new OfflineAudioContext(1, 1, 44100); try { const buf = await ctx.decodeAudioData(await blob.arrayBuffer()); return buf.length / buf.sampleRate; } catch (e) { return null; } }`;
