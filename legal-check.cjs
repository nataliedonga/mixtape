// Checks for Mixtape's legal transcript inserts. Run: node legal-check.cjs
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = {}; vm.createContext(ctx);
for (const f of ['lyrics-core.js', 'transcript-core.js', 'transcribe/legal-presets.js', 'legal-core.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), ctx);
const T = ctx.TranscriptCore, L = ctx.LegalCore, P = ctx.LegalPresets;
let pass = 0, fail = 0;
const ok = (c, what) => { if (c) { pass++; console.log('ok  ', what); } else { fail++; console.log('FAIL', what); } };
const eq = (a, b, what) => ok(JSON.stringify(a) === JSON.stringify(b), `${what}${JSON.stringify(a) === JSON.stringify(b) ? '' : `: got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`}`);

// ---- presets are data ----
ok(P.ORDER.length === 6 && P.ORDER.every(id => P.PRESETS[id]) && P.DEFAULT === 'us-company', 'six presets, the company style first');
const codes = P.CATALOG.map(c => c.code);
ok(new Set(codes).size === codes.length, 'every short code is different');
ok(P.CATALOG.every(c => P.GROUPS.includes(c.group)), 'every insert is in one of the six groups');
const pres = Object.fromEntries(P.ORDER.map(id => [id, L.preset(id)]));
ok(P.ORDER.every(id => P.CATALOG.every(c => c.kind === 'sp' || (c.as || c.id) in pres[id].wording)), 'every preset says, for every insert, its wording or that it does not exist');
ok(P.ORDER.every(id => [...pres[id].unsourced].every(k => pres[id].wording[k] != null)), 'only wording that exists is marked as not from a standard');
eq(L.fill(pres['us-company'].wording.ina, { time: '00:12:34' }), '[inaudible 00:12:34]', 'company style: inaudible carries the time');
eq(L.fill(pres['us-court'].wording.ina, { time: '00:12:34' }), '(inaudible)', 'court style: inaudible in parentheses, no time');
eq(L.fill(pres['sa-court'].wording.iv, {}), '...[intervenes]', 'the same code gives South African wording in that preset');
eq(L.fill(pres['uk'].wording.xt, {}), '-- (overspeaking) --', 'UK overspeaking');
ok(pres['us-company'].wording.dx === null && pres['us-company'].wording.sw === null, 'company style has no headings or swear-in lines (the company adds them)');
ok(pres['us-court'].wording.lau === null && pres['sa-court'].wording.lau === '[laughter]', 'laughter does not exist in US legal work and does in South Africa');
ok(L.inserts(pres['us-depo']).find(x => x.id === 'cx').tpl === 'CROSS-EXAMINATION' && pres['us-court'].wording.cx === 'CROSS EXAMINATION', 'a preset inherits and overrides');
const mine = L.preset('us-court', { wording: { 'us-court': { ina: '[inaudible]', nod: null } }, codes: { ina: 'x' } });
ok(mine.wording.ina === '[inaudible]' && !L.inserts(mine).some(x => x.id === 'nod') && L.byCode(L.inserts(mine)).get('x').id === 'ina' && L.preset('us-depo', { wording: { 'us-court': { ina: 'Z' } } }).wording.ina === '(inaudible)', 'a person’s own wording and codes sit on top of one preset only');

// ---- templates ----
eq(L.fill('([[{party} ]]Exhibit {n}[[, {desc},]] marked for identification.)', { n: '3' }), '(Exhibit 3 marked for identification.)', 'empty optional parts are left out');
eq(L.fill('([[{party} ]]Exhibit {n}[[, {desc},]] was marked for identification.)', { n: '1', party: 'Plaintiff’s', desc: 'a lease dated May 1, 2021' }), '(Plaintiff’s Exhibit 1, a lease dated May 1, 2021, was marked for identification.)', 'party and description go in when given');
eq(L.fill('{NAME}, [[{PARTY} WITNESS, ]]SWORN', { name: 'John Smith', party: 'Plaintiff’s' }), 'JOHN SMITH, PLAINTIFF’S WITNESS, SWORN', 'capital placeholders capitalise');
eq(L.fill('COURT ADJOURNS:[[ [{clock}]]]', {}), 'COURT ADJOURNS:', 'an optional part that ends in a bracket');
eq(L.fill('COURT ADJOURNS:[[ [{clock}]]]', { clock: '11:14' }), 'COURT ADJOURNS: [11:14]', 'and filled');
eq(L.fill('(Proceedings adjourned to {date}.)', {}), '(Proceedings adjourned to ___.)', 'a value nobody gave is a visible blank, never a guess');
eq(L.fields('([[{party} ]]Exhibit {n}[[, {desc},]] at {time} {N})'), ['party', 'n', 'desc'], 'the values a wording asks for');
eq([L.fmtTime(754, 'hms'), L.fmtTime(222, 'ms')], ['00:12:34', '03:42'], 'time forms');
eq([L.clockAt('9:44 am', 5400), L.clockAt('09:44', 60), L.clockAt('', 60), L.clockAt('11:50 p.m.', 1200)], ['11:14 a.m.', '09:45', '', '12:10 a.m.'], 'a time of day is only worked out when the start is known');

// ---- short codes ----
eq(L.codeAt('he said ;ina', 12), { start: 8, code: 'ina' }, 'a code after a space');
eq(L.codeAt(';dx', 3), { start: 0, code: 'dx' }, 'a code at the very start');
ok(L.codeAt('a;b', 3) === null && L.codeAt('yes;no', 6) === null, 'not inside a word');
ok(L.codeAt('text ;ina more', 14) === null && L.codeAt('text ;ina more', 9).code === 'ina', 'the caret can be anywhere: only the code just before it counts');
ok(L.codeAt('semi; ', 6) === null && L.codeAt('x ;', 3) === null, 'a bare semicolon is not a code');

// ---- exhibits ----
eq(['3', 'A', 'Z', 'G(10)', 'P-9', '1B', '009', 'az', ''].map(L.nextId), ['4', 'B', 'AA', 'G(11)', 'P-10', '1C', '010', 'ba', ''], 'the next identifier in a series');
const base = T.fromText('first paragraph here\n\nsecond paragraph here\n\nthird one').map((w, i) => ({ ...w, s: i, e: i + 0.5 }));
let W = L.insertBlock(base, 1, '(Exhibit 1 marked for identification.)', { k: 'n', id: 'exm', x: { party: '', n: '1', ev: 'marked' } }, 2.2).words;
ok(T.paragraphs(W).length === 4 && W[3].lg.id === 'exm' && W[3].p && W[3].s === 2.5 && W[8].p, 'a notation goes after the paragraph being played, as its own paragraph, in time order');
ok(W.every((w, i) => i === 0 || w.s >= W[i - 1].s), 'times still never go backwards');
W = L.insertBlock(W, 9, '(Defendant’s Exhibit A marked for identification.)', { k: 'n', id: 'exm', x: { party: 'Defendant’s', n: 'A', ev: 'marked' } }, 8).words;
W = L.insertBlock(W, W.length - 1, '(Exhibit 1 received in evidence.)', { k: 'n', id: 'exr', x: { party: '', n: '1', ev: 'received' } }, 12).words;
let ev = L.events(W);
eq(L.proposeExhibit(ev, 'marked', ''), { party: '', n: '2' }, 'the next number is proposed from the last in the same series');
eq(L.proposeExhibit(ev, 'marked', 'Defendant’s'), { party: 'Defendant’s', n: 'B' }, 'each party has its own series');
eq(L.proposeExhibit(ev, 'marked', 'Government’s'), { party: 'Government’s', n: '' }, 'a series with nothing in it proposes nothing');
eq(L.proposeExhibit(ev, 'received', ''), { party: 'Defendant’s', n: 'A' }, 'to receive: the last exhibit marked and not yet received');
ok(L.alreadyMarked(ev, '', '1') && !L.alreadyMarked(ev, '', '2') && !L.alreadyMarked(ev, 'Defendant’s', '1'), 'an exhibit already marked is known (to warn on a second marking)');
const rows = L.exhibitRows(ev);
ok(rows.length === 2 && rows[0].marked && rows[0].received && rows[1].marked && !rows[1].received, 'the exhibit index: one row each, marked and received');
ok(L.exhibitRows({ exhibits: [{ n: '3', n2: '5', party: '', ev: 'marked', i: 0 }] }).map(r => r.n).join() === '3,4,5', 'a range marks each exhibit in it');
const chk = L.check(W, pres['us-court']);
ok(chk.some(c => /marked but not received/.test(c.what) && c.n === 1), 'the check before saving: marked but not received');
const I = L.insertInline(base, 1, '[inaudible 00:00:01]', null, 1.2);
ok(I.words.length === base.length + 2 && I.words[2].t === '[inaudible' && !I.words[2].p && I.words[2].s === 1.5 && T.paragraphs(I.words).length === 3, 'a tag goes into the running text after the word being spoken');
ok(L.check(I.words, pres['us-company']).some(c => /Inaudible or/.test(c.what) && c.n === 1) && L.check(L.insertInline(base, 1, '[inaudible]', null, 1).words, pres['us-company']).some(c => /no time/.test(c.what)), 'the check counts inaudible tags, and those missing their time');
ok(L.insertBlock(base, -1, 'DIRECT EXAMINATION', { k: 'n', id: 'dx' }, 0).words[2].p, 'a notation before everything keeps the old first paragraph a paragraph');

// ---- witnesses and examinations ----
const talk = T.fromText('q one\n\na one\n\nq two\n\na two\n\nobjection\n\nq three\n\na three').map((w, i) => ({ ...w, s: i, e: i + 0.5 }));
let X = L.insertBlock(talk, -1, 'JOHN SMITH, SWORN', { k: 'n', id: 'sw', w: { name: 'John Smith', party: '', oath: 'sworn' } }, 0).words;
X = L.insertBlock(X, 0, 'DIRECT EXAMINATION', { k: 'n', id: 'dx', ex: { type: 'dx', by: 'MR. JONES' } }, 0).words;
const hd = L.heads(X);
ok(L.examAt(X, hd[2]).by === 'MR. JONES' && L.examAt(X, 0) === null, 'a paragraph knows which examination it is in');
X = L.flowQA(X, hd[1], 'MR. JONES', 'THE WITNESS');
eq(hd.slice(2).map(h => L.kind(X[h])).join(''), 'qaqaqaq', 'questions and answers are proposed, alternating');
ok(X[hd[2]].sp === 'MR. JONES' && X[hd[3]].sp === 'THE WITNESS', 'the examiner asks, the witness answers');
X = L.setQA(X, hd[6], 'c');
ok(L.kind(X[hd[6]]) === 'c' && L.kind(X[hd[7]]) === 'a', 'one paragraph made colloquy');
ok(L.warnings(X).size === 1 && /resumes with a question/.test(L.warnings(X).get(hd[7])), 'warning: after an interruption an examination resumes with a question');
X = L.setQA(X, hd[7], 'q', 'MR. JONES', 'THE WITNESS', true);
eq(hd.slice(2).map(h => L.kind(X[h])).join(''), 'qaqacqa', 'flipping one and all that follow puts a slipped alternation right');
ok(L.warnings(X).size === 0, 'no warnings when the order is right');
ok(L.warnings(L.setQA(X, hd[4], 'a')).size === 2 && /answer follows an answer/.test(L.warnings(L.setQA(X, hd[4], 'a')).get(hd[4])), 'warning: an answer only follows a question');
ok(L.warnings(L.setQA(talk, 0, 'q', 'A', 'B')).size === 1, 'warning: a question with no examination above it');
const two = T.fromText('one\n\ntwo\n\nthree\n\nfour\n\nfive').map((w, i) => ({ ...w, s: i, e: i, sp: ['Speaker 2', 'Speaker 1', 'Speaker 2', 'Speaker 3', 'Speaker 1'][i] }));
let Y = L.insertBlock(two, -1, 'CROSS-EXAMINATION', { k: 'n', id: 'cx', ex: { type: 'cx', by: 'MS. LEE' } }, 0).words; Y = L.flowQA(Y, 0, 'MS. LEE', 'THE WITNESS');
eq(L.heads(Y).slice(1).map(h => L.kind(Y[h])).join(''), 'qaqca', 'where two voices were told apart, the first asks, the second answers, a third is colloquy');
const one = T.fromText('one\n\ntwo\n\nthree\n\nfour\n\nfive').map((w, i) => ({ ...w, s: i, e: i, ...(i === 2 ? { sp: 'THE COURT' } : {}) }));
let Z = L.insertBlock(one, -1, 'DIRECT EXAMINATION', { k: 'n', id: 'dx', ex: { type: 'dx', by: 'MR. JONES' } }, 0).words; Z = L.flowQA(Z, 0, 'MR. JONES', 'THE WITNESS');
eq(L.heads(Z).slice(1).map(h => L.kind(Z[h]) + (Z[h].sp === 'THE COURT' ? '!' : '')).join(''), 'qac!qa', 'a paragraph somebody already named stays theirs, and the examination resumes with a question after it');
const ev2 = L.events(L.insertBlock(X, X.length - 1, 'CROSS-EXAMINATION', { k: 'n', id: 'cx', ex: { type: 'cx', by: 'MS. LEE' } }, 20).words);
ok(ev2.witnesses.length === 1 && ev2.witnesses[0].exams.map(e => e.col).join() === 'Direct,Cross' && ev2.witnesses[0].exams[1].by === 'MS. LEE', 'the witness index: each witness with the examinations under them');

// ---- correcting a paragraph keeps the marks ----
const fix = (words, pi, text, c) => { const p = T.paragraphs(words)[pi]; return L.edited(words, p.i0, p.i1, T.editParagraph(words, p.i0, p.i1, text), c); };
let E = fix(X, 2, 'question one, corrected', { on: true });
ok(L.kind(E[hd[2]]) === 'q' && E[hd[2]].sp === 'MR. JONES', 'a corrected question is still a question');
E = fix(X, 0, 'JOHN A. SMITH, SWORN', { on: true });
ok(E[0].lg.id === 'sw' && E[0].lg.hand === true && fix(X, 0, 'JOHN SMITH, SWORN', { on: true })[0].lg.hand !== true, 'a notation reworded by hand keeps its mark and says so');
E = fix(X, 2, 'q one\n\nyes it was\n\nand then', { on: true, witness: 'THE WITNESS' });
eq(L.heads(E).slice(2, 5).map(h => L.kind(E[h]) + ':' + E[h].sp), ['q:MR. JONES', 'a:THE WITNESS', 'q:MR. JONES'], 'a blank line in an examination starts the answer, the next one the next question');
const pend = [{ txt: '(Exhibit 2 marked for identification.)', lg: { k: 'n', id: 'exm', x: { party: '', n: '2', ev: 'marked' } } }];
E = fix(X, 2, 'do you know this\n\n(Exhibit 2 marked for identification.)\n\nthis document', { on: true, pending: pend });
const eh = L.heads(E).slice(2, 5);
ok(L.kind(E[eh[0]]) === 'q' && E[eh[1]].lg.id === 'exm' && !E[eh[1]].sp && L.kind(E[eh[2]]) === 'q' && E[eh[2]].sp === 'MR. JONES' && pend[0].used, 'an insert typed in the box becomes a notation, and the same speaker carries on after it');
ok(L.events(E).exhibits.length === 1, 'and it is in the exhibit index');
E = fix(X, 6, 'THE COURT: overruled', { on: true, labels: ['THE COURT', 'MR. JONES'] });
ok(E[hd[6]].sp === 'THE COURT' && E[hd[6]].t === 'overruled' && L.kind(E[hd[6]]) === 'c' && E.length === X.length, 'a known speaker label typed at the start names the speaker');
ok(fix(X, 6, 'THE JUDGE: overruled', { on: true, labels: ['THE COURT'] })[hd[6]].t === 'THE', 'an unknown label is left as text: speakers are never guessed');
E = fix(X, 6, 'well\n\nA. it was\n\nQ. and then', { on: true, witness: 'THE WITNESS', labels: [] });
eq(L.heads(E).slice(6, 9).map(h => L.kind(E[h]) + ':' + E[h].t), ['c:well', 'a:it', 'q:and'], 'Q. and A. typed at the start mark a question and an answer');
ok(fix(talk, 0, 'A. one', { on: true })[0].t === 'A.', 'but not outside an examination');
const sa = L.insertInline(talk, 0, 'EXHIBIT G(11)', { id: 'exm', x: { party: '', n: 'G(11)', ev: 'marked' } }, 0.5).words;
ok(sa[1].lg.k === 'i' && sa[1].lg.len === 2 && L.events(sa).exhibits[0].n === 'G(11)', 'an exhibit written into the running text (South Africa) is an event too');
ok(L.events(fix(sa, 0, 'q EXHIBIT G(11) one more', { on: true })).exhibits.length === 1 && L.events(fix(sa, 0, 'q something else', { on: true })).exhibits.length === 0, 'it survives a correction that keeps its words, and goes when they go');
const grown = fix(talk, 0, 'q one ' + 'more '.repeat(30), { on: true });
ok(grown.every((w, i) => i === 0 || w.s >= grown[i - 1].s), 'many words added to a paragraph never run past the start of the next');
ok(fix(X, 2, '', { on: true }).length === X.length - 2, 'a paragraph deleted in the box is simply gone');
ok(L.edited(talk, 0, 2, T.editParagraph(talk, 0, 2, 'q uno'), null)[0].t === 'q', 'with legal mode off nothing is parsed');

// ---- exports ----
let D = L.insertBlock(talk, -1, 'JOHN SMITH, SWORN', { k: 'n', id: 'sw', w: { name: 'John Smith', party: '', oath: 'sworn' } }, 0).words;
D = L.insertBlock(D, 0, 'DIRECT EXAMINATION', { k: 'n', id: 'dx', ex: { type: 'dx', by: 'MR. JONES' } }, 0).words; D = L.flowQA(D, 3, 'MR. JONES', 'THE WITNESS');
const dh = L.heads(D); D = L.setQA(D, dh[6], 'c'); D[dh[6]] = { ...D[dh[6]], sp: 'MS. LEE' }; D = L.setQA(D, dh[7], 'q', 'MR. JONES', 'THE WITNESS', true);
D = L.insertBlock(D, dh[3], '(Exhibit 1 marked for identification.)', { k: 'n', id: 'exm', x: { party: '', n: '1', ev: 'marked' } }, 3).words;
const txt = L.toTxt(D, {}, pres['us-court']).split('\n').filter(Boolean);
ok(/^ +JOHN SMITH, SWORN$/.test(txt[0]) && /^ +DIRECT EXAMINATION$/.test(txt[1]), 'US court text: headings centred');
eq(txt.slice(2, 5), ['BY MR. JONES:', 'Q   q one', 'A   a one'], 'by-line, then Q and A at the margin with the words on the fifth space');
ok(txt[5] === '    (Exhibit 1 marked for identification.)' && txt[6] === 'BY MR. JONES:' && txt[7] === 'Q   q two', 'a parenthetical on the fifth space, and the by-line again after it');
ok(txt[9] === '         MS. LEE:  objection' && txt[10] === 'BY MR. JONES:', 'colloquy on the tenth space, and the by-line again after colloquy');
ok(!L.toTxt(D, {}, pres['us-company']).includes('BY MR.'), 'company style: no by-lines');
const sat = L.toTxt(D, {}, pres['sa-court']).split('\n').filter(Boolean);
ok(sat[2] === 'MR. JONES: q one' && sat[3] === 'THE WITNESS: a one', 'South Africa: named speakers, no Q and A letters');
ok(L.toTxt(D, { qaLayout: 'dash' }, pres['sa-court']).includes('MR. JONES: q one --- a one'), 'South Africa, dash layout: the answer follows the question after three dashes');
ok(L.toTxt(D, {}, pres['uk']).includes('Q.  q one\n\nA.  a one'), 'UK: Q. and A.');
const sp = L.spoken(D);
ok(sp.length === talk.length && sp.every(w => !/SWORN|EXAMINATION|Exhibit/.test(w.t)) && sp[0].p, 'subtitles get only what was said');
const cues = T.cues(sp);
ok(cues.every((c, i) => c.end >= c.start && (i === 0 || c.start >= cues[i - 1].start)) && !T.toSrt(sp).includes('Exhibit'), 'and their cue times stay in order');
ok(JSON.stringify(JSON.parse(JSON.stringify({ words: D })).words) === JSON.stringify(D), 'the marks are plain data: they survive a save as .json');
const long = T.fromText(Array.from({ length: 40 }, (_, k) => `paragraph ${k} ` + 'word '.repeat(30).trim()).join('\n\n')).map((w, i) => ({ ...w, s: i, e: i }));
const LG = L.insertBlock(long, long.length - 1, '(Exhibit 9 marked for identification.)', { k: 'n', id: 'exm', x: { party: '', n: '9', ev: 'marked' } }, 5).words;
const pg = L.toPages(LG, {}, pres['us-court']);
const plines = pg.text.split('\f\n')[0].split('\n').filter(Boolean);
ok(plines.length === 26 && /^ 1 {2}/.test(plines[1]) && /^25 {2}/.test(plines[25]) && plines.every(l => l.length <= 63 + 4), 'numbered pages: 25 numbered lines, none wider than the page');
const ref = pg.refs.get(L.events(LG).exhibits[0].i), [rp, rl] = ref.split(':').map(Number);
ok(pg.text.split('\f\n')[rp - 1].split('\n')[rl].includes('(Exhibit 9 marked'), 'a page:line reference points at the line it names');
ok(L.toPages(LG, {}, pres['us-court'], { lines: 28 }).pages < pg.pages || L.toPages(LG, {}, pres['us-court'], { lines: 28 }).text.split('\f\n')[0].split('\n').filter(Boolean).length === 29, 'lines per page can be changed (28 in some courts)');
ok(/^ {4}paragraph/m.test(L.toPages(LG, {}, pres['sa-court']).text) && /^10 {2}/m.test(L.toPages(LG, {}, pres['sa-court']).text) && !/^ 1 {2}/m.test(L.toPages(LG, {}, pres['sa-court']).text), 'South Africa: only every tenth line is numbered');
const idx = L.indexText(D, pres['us-court'], e => T.short(e.at));
ok(/JOHN SMITH \(sworn\)/.test(idx) && /Direct by MR\. JONES/.test(idx) && /Exhibit 1 +0:03 +--/.test(idx), 'the index text: witness, examination, exhibit marked, -- where not received');
const cert = L.toTxt(D, { cert: { text: pres['us-court'].certs[0].text, name: 'N. Donga' }, cover: { Court: 'Test Court' }, people: [{ title: 'MR', name: 'Jones', party: 'the plaintiff' }] }, pres['us-court']);
ok(/^COURT: Test Court/.test(cert) && /MR\. JONES, for the plaintiff/.test(cert) && /CERTIFICATE/.test(cert) && /N\. Donga/.test(cert) && !/CERTIFICATE/.test(L.toTxt(D, {}, pres['us-court'])), 'cover, appearances and certificate print only when the person filled them in');
ok(P.ORDER.every(id => (pres[id].certs || []).every(c => !/duly sworn|machine shorthand|CET|CSR/.test(c.text))) && pres['us-court'].certs.filter(c => /court approved/.test(c.text)).every(c => c.needs), 'no certificate claims a credential, and the court-approved one needs a declaration');

// ---- speakers ----
const leg = { people: [{ title: 'MR', name: 'Smith', party: 'Plaintiff' }, { title: 'MS', name: 'jones' }] };
eq(L.slots(pres['us-court'], leg).map(s => s.label), ['THE COURT', 'THE WITNESS', 'MR. SMITH', 'MS. JONES'], 'slots: the fixed roles, then the appearances, formatted by the preset');
eq(L.slots(pres['sa-court'], leg).map(s => s.label), ['COURT', 'WITNESS', 'MR SMITH', 'MS JONES'], 'the same people in South African form');
eq([L.resolveBy(pres['us-court'], leg, '3'), L.resolveBy(pres['us-court'], leg, 'ms. lee'), L.resolveBy(pres['uk'], leg, 'mr brown'), L.resolveBy(pres['us-court'], leg, '9')], ['MR. SMITH', 'MS. LEE', 'MR BROWN', ''], 'an examining attorney by slot number or by name');
eq(L.slots(pres['us-depo'], { roles: { w: 'THE DEPONENT' } }).map(s => s.label), ['THE DEPONENT', 'THE REPORTER'], 'a role label can be changed for one transcript');

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
