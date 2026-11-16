// Checks for Cutter's model. Run: node check.mjs
import * as C from './model.js';
let pass = 0, fail = 0;
const ok = (cond, what) => { if (cond) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what); } };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// times
ok(C.fmtTime(3723.5, 24) === '01:02:03:12', 'video time is hh:mm:ss:ff');
ok(C.fmtTime(3723.456) === '01:02:03.46', 'sound time is hh:mm:ss.cc');
ok(C.fmtTime(59.999, 30) === '00:01:00:00', 'a time just under a minute rounds to the frame, carrying into minutes');
ok(C.parseTime('1:02:03') === 3723, 'h:mm:ss reads');
ok(C.parseTime('62') === 62, 'plain seconds read');
ok(C.parseTime('1:02.25') === 62.25, 'm:ss.cc reads');
ok(near(C.parseTime('00:00:01:12', 24), 1.5), 'hh:mm:ss:ff reads with fps');
ok(C.parseTime('1h2m3s') === 3723 && C.parseTime('10m') === 600 && C.parseTime('45s') === 45 && C.parseTime('1.5h') === 5400, 'unit forms read');
ok(C.parseTime('abc') === null && C.parseTime('1::2') === null && C.parseTime('') === null, 'nonsense is refused');
ok(C.fmtLength(12.4) === '12.4 s' && C.fmtLength(252) === '4 min 12 s' && C.fmtLength(7500) === '2 h 05 min', 'friendly lengths');
ok(C.snapFrame(1.019, 24) === 1 && near(C.snapFrame(1.03, 24), 25 / 24), 'times snap to the frame grid');

// 29.97, 23.976 and 59.94 fps: the clock part is real time and every frame reads back as itself
const NTSC = 30000 / 1001, frames = [0, 1, 29, 30, 31, 1797, 1798, 1799, 1800, 17981, 17982, 107891, 107892, 107893, 215784, 1078921];
ok(C.fmtTime(3600, NTSC) === '00:59:59:29' && C.fmtTime(3600.03, NTSC) === '01:00:00:00', 'at 29.97 fps an hour of real time shows as an hour (not 00:59:56:12)');
ok(frames.every(n => near(C.parseTime(C.fmtTime(n / NTSC, NTSC), NTSC), n / NTSC, 1e-9)), 'at 29.97 fps a time read back from its own box is the same frame');
ok([24000 / 1001, 60000 / 1001, 120000 / 1001].every(f => frames.every(n => near(C.parseTime(C.fmtTime(n / f, f), f), n / f, 1e-9))), 'the same holds at 23.976, 59.94 and 119.88 fps');
ok(frames.every(n => { const t = n / NTSC, [h, m, s] = C.fmtTime(t, NTSC).split(':').map(Number); return Math.abs(h * 3600 + m * 60 + s - t) < 1; }), 'at 29.97 fps hh:mm:ss is within a second of the real time, an hour in and ten hours in');
ok([24, 25, 30, 60].every(f => frames.every(n => C.fmtTime(n / f, f) === `${String(Math.floor(n / f / 3600)).padStart(2, '0')}:${String(Math.floor(n / f / 60) % 60).padStart(2, '0')}:${String(Math.floor(n / f) % 60).padStart(2, '0')}:${String(n % f).padStart(2, '0')}`)), 'whole frame rates show exactly as before');
{ const t0 = 107892 / NTSC, t1 = 215784 / NTSC, b = C.partsFromCsv(C.partsToCsv([{ t0, t1, name: 'x' }], NTSC), 9000, NTSC); ok(b.length === 1 && near(b[0].t0, t0, 1e-9) && near(b[0].t1, t1, 1e-9), 'a 29.97 fps list saved and loaded again does not move (it used to shift 3.6 s an hour)'); }

// copy range snaps outward to keyframes
const keys = [0, 2, 4, 6, 8];
ok(eq(C.copyRange(3, 5, keys, 9), { t0: 2, t1: 6, moved: true }), 'an untouched cut widens to the keyframes around it');
ok(eq(C.copyRange(4, 6, keys, 9), { t0: 4, t1: 6, moved: false }), 'a cut on keyframes stays put');
ok(eq(C.copyRange(7, 9, keys, 9), { t0: 6, t1: 9, moved: true }), 'a cut to the end ends at the end');

// parts
let P = C.addPart([], 10, 20, 100, 24);
ok(P.length === 1 && P[0].t0 === 10 && P[0].t1 === 20, 'a part is added');
P = C.addPart(P, 5, 2, 100, 24);
ok(P[0].t0 === 2 && P[0].t1 === 5, 'a part drawn backwards is turned round, and parts stay in time order');
const id = P[1].id;
let Q = C.setStart(P, id, 25, 100, 24);
ok(Q[1].t0 === 25 && Q[1].t1 === 35, 'a start past the end carries the end along by the part length');
Q = C.setEnd(P, id, 8, 100, 24);
ok(Q.find(p => p.id === id).t1 === 8 && Q.find(p => p.id === id).t0 === 0, 'an end before the start pulls the start back (not below 0)');
Q = C.setLength(P, id, 30, 100, 24);
ok(Q.find(p => p.id === id).t1 === 40, 'a length moves the end');
Q = C.setLength(P, id, 500, 100, 24);
ok(Q.find(p => p.id === id).t1 === 100, 'a length past the end of the file stops at the end');
Q = C.setStart(P, id, 99.99, 100, 24);
ok(near(Q.find(p => p.id === id).t1 - Q.find(p => p.id === id).t0, 1 / 24) && Q.find(p => p.id === id).t1 <= 100, 'a part pushed to the end keeps at least one frame');
Q = C.splitPartAt(P, 15, 100, 24);
ok(Q.length === 3 && Q[1].t1 === 15 && Q[2].t0 === 15 && Q[2].t1 === 20, 'split at the playhead makes two parts');
ok(C.splitPartAt(P, 50, 100, 24).length === 2, 'split outside any part changes nothing');
ok(eq(C.movePart(Q, Q[2].id, 0).map(p => p.t0), [15, 2, 10]), 'parts can be reordered for joining');
// an order set by hand (for joining) survives every edit; a list still in time order stays in time order
const hand = C.movePart([{ id: 'a', t0: 10, t1: 20, name: '' }, { id: 'b', t0: 30, t1: 40, name: '' }, { id: 'c', t0: 50, t1: 60, name: '' }], 'c', 0), ids = l => l.map(p => p.id).join('');
ok(ids(hand) === 'cab' && !C.inTimeOrder(hand) && C.inTimeOrder(C.sortParts(hand)), 'a list reordered by hand is known as such');
ok(ids(C.keepOrder(hand, C.setEnd(hand, 'a', 25, 100, 24))) === 'cab', 'dragging an edge keeps a hand-set order');
{ const added = C.addPart(hand, 0, 5, 100, 24); ok(added.length === 4 && ids(added.slice(0, 3)) === 'cab' && added[3].t0 === 0, 'a new part in a hand-ordered list goes last, the rest stay put'); }
{ const sp = C.splitPartAt(hand, 15, 100, 24); ok(sp.length === 4 && sp[0].id === 'c' && sp[1].id === 'a' && sp[1].t1 === 15 && sp[2].t0 === 15 && sp[3].id === 'b', 'splitting a part in a hand-ordered list leaves its halves in its place'); }
{ const timeList = C.sortParts(hand), moved = C.updatePart(timeList, 'a', { t0: 70, t1: 80 }, 100, 24); ok(ids(C.keepOrder(timeList, moved)) === 'bca', 'a list in time order stays in time order when a part is dragged past another'); }

// ranges
ok(eq(C.mergeRanges([{ t0: 5, t1: 8 }, { t0: 1, t1: 3 }, { t0: 2, t1: 4 }, { t0: 8, t1: 9 }]), [{ t0: 1, t1: 4 }, { t0: 5, t1: 9 }]), 'overlapping and touching ranges merge');
ok(eq(C.invertRanges([{ t0: 10, t1: 20 }, { t0: 30, t1: 40 }], 50), [{ t0: 0, t1: 10 }, { t0: 20, t1: 30 }, { t0: 40, t1: 50 }]), 'cutting parts out keeps what is between them');
ok(eq(C.invertRanges([{ t0: 0, t1: 20 }, { t0: 15, t1: 50 }], 50), []), 'cutting out everything leaves nothing');
const er = C.exportRanges([{ t0: 30, t1: 40, name: 'b' }, { t0: 10, t1: 20, name: 'a' }], 'keep', 50);
ok(er[0].name === 'b' && er[1].index === 2, 'keep mode exports parts in list order with their names');
ok(C.totalLength(C.exportRanges([{ t0: 10, t1: 20 }], 'remove', 50)) === 40, 'remove mode exports the rest of the file');

// splitting
const eqParts = C.splitEqual(0, 100, 3, 24);
ok(eqParts.length === 3 && eqParts[2].t1 === 100 && near(eqParts[1].t0, C.snapFrame(100 / 3, 24)), 'equal parts cover the file on the frame grid');
const ev = C.splitEvery(0, 25, 10);
ok(eq(ev.map(p => [p.t0, p.t1]), [[0, 10], [10, 20], [20, 25]]), 'every 10 s, with the rest in the last part');
ok(eq(C.splitAtPoints(0, 10, [7, 3, 3, 0, 12]).map(p => [p.t0, p.t1]), [[0, 3], [3, 7], [7, 10]]), 'split at points ignores repeats and points outside');
// silences: 10 buckets of 0.5 s; quiet in buckets 2-4 (1.0-2.5 s) and 8 (4.0-4.5 s)
const amp = [0.5, 0.5, 0.001, 0.001, 0.001, 0.5, 0.5, 0.5, 0.001, 0.5];
const pk = { min: Float32Array.from(amp, x => -x), max: Float32Array.from(amp), bucketSec: 0.5 };
const sil = C.findSilences(pk, -40, 0.8);
ok(eq(sil, [{ t0: 1, t1: 2.5 }]), 'a silence must be long enough to count');
ok(eq(C.findSilences(pk, -40, 0.4).length, 2), 'a shorter minimum finds the short silence too');
const between = C.partsBetweenSilences(sil, 5, 0.1);
ok(between.length === 2 && near(between[0].t1, 1.1) && near(between[1].t0, 2.4) && between[1].t1 === 5, 'parts between silences keep a little of each silence');
// scene changes: steady small differences with two big jumps
const diffs = Array.from({ length: 60 }, (_, i) => ({ t: i / 24, d: i === 20 ? 0.6 : i === 21 ? 0.3 : i === 45 ? 0.5 : 0.02 }));
ok(eq(C.sceneCuts(diffs, 0.5), [20 / 24, 45 / 24]), 'scene changes are the big jumps (a neighbour of a jump is not another cut)');
ok(eq(C.sceneCuts(diffs.map(x => ({ ...x, d: 0.02 })), 1), []), 'steady footage has no scene changes');

// names and lists
ok(C.fileNameFor('Interview', { t0: 3723, t1: 3900.5 }, '.mp4') === 'Interview (1.02.03-1.05.00.50).mp4', 'file names carry the times');
ok(C.fileNameFor('Song', { t0: 0, t1: 1, name: 'Chorus: take/2' }, '.wav') === 'Song - Chorus- take-2.wav', 'a named part is named, with unsafe characters made safe');
ok(C.fileNameFor('Song', null, '.mp4', true, 3) === 'Song (3 parts joined).mp4', 'a joined file says how many parts');
const csv = C.partsToCsv([{ t0: 1.5, t1: 3, name: 'a, "b"' }], 24);
const back = C.partsFromCsv(csv, 10, 24);
ok(back.length === 1 && back[0].t0 === 1.5 && back[0].t1 === 3 && back[0].name === 'a, "b"', 'a parts list goes to CSV and back');
ok(C.partsFromCsv('start;end;name\n0:10;0:20;x\nbroken\n1m;90s;', 120).length === 2, 'CSV from a spreadsheet (semicolons, unit times) reads, broken rows skipped');
{ const cp = C.clipParts([{ name: '001 audio.mp3', length: 10 }, { name: '002 audio.mp3', length: 5.5 }, { name: '003 audio.mp3', length: 4 }], 19.5);
  ok(cp.length === 3 && cp.map(p => `${p.name}:${p.t0}-${p.t1}`).join(' ') === '001 audio:0-10 002 audio:10-15.5 003 audio:15.5-19.5', 'the clips of a joined file become its parts, each from where it was joined on, named after its clip: ' + cp.map(p => `${p.name}:${p.t0}-${p.t1}`).join(' '));
  ok(C.clipParts([{ name: 'a.mp3', length: 10 }, { name: 'b.mp3', length: 10 }, { name: 'c.mp3', length: 10 }], 12).map(p => p.t1).join() === '10,12' && C.clipParts(null, 5).length === 0, 'clips past the end of a shorter file are left out, and the last is cut to the end'); }

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
