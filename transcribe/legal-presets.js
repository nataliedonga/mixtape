/* Mixtape legal transcript inserts: the data. No code that touches a page lives here.
   The catalogue lists every insert once (its short code, its group, what kind of thing it is). A preset is a table of
   wording for those inserts plus the conventions of one kind of legal work: brackets, speaker labels, the question and
   answer layout, the time form, the page. The same short code works in every preset; only the wording changes.

   Wording comes from research/legal-transcript-inserts.md (2026-11-15). An insert listed under `unsourced` was NOT found
   in a published standard: it is offered, can be edited, and is marked "check against your client's sample" on screen.

   To add a preset: add an entry to PRESETS with a `base` (it inherits everything it does not set) and override
   `wording` (a string, or null where the insert does not exist in that kind of work), `unsourced`, `roles`, `titles`,
   `qa`, `page`. Nothing else needs to change; add its id to ORDER to list it.

   Template marks:  {n} {desc} {party} {name} {by} {clock} {date} {reason} {what}  are asked for (never guessed);
   {NAME} {PARTY} {BY} {DATE} are the same values in capitals;  {time} is the position in the recording;
   [[ ... ]] is left out when a value inside it is empty.
   Loaded as a classic script (window.LegalPresets) and by Node. */
(function (root) {
  const GROUPS = ['Speech and audio', 'Exhibits', 'Witness', 'Examinations', 'Speakers', 'Proceedings'];
  const GESTURE = 'Only when counsel or the court refers to it on the record. Working from sound alone you usually cannot see it, and a gesture is never turned into a word.';
  const LAST = 'A last resort: replay it and check the context first. A word you heard but cannot spell is (phonetic), not inaudible.';
  const OATH = 'Only when the swearing is on the recording. If you cannot tell whether the witness was sworn or affirmed, use "Witness called" instead.';
  /* kind: in = goes into the running text · bl = a notation on its own line · sp = a speaker label · ex = an examination
     heading (starts questions and answers) · xh = an exhibit event · wi = a witness event */
  const c = (id, group, kind, name, more) => Object.assign({ id, code: id, group: GROUPS[group], kind, name }, more || {});
  const CATALOG = [
    c('ina', 0, 'in', 'Inaudible', { warn: LAST, count: 'unclear' }),
    c('ind', 0, 'in', 'Indiscernible / indistinct', { warn: LAST, count: 'unclear' }),
    c('indr', 0, 'in', 'Indiscernible, with the reason', { warn: LAST, count: 'unclear', lists: { reason: ['overlapping speakers', 'background noise', 'rapid speech', 'away from microphone'] } }),
    c('xt', 0, 'in', 'Crosstalk (speakers at once)'),
    c('iv', 0, 'in', 'Interruption (cut off by another speaker)'),
    c('tr', 0, 'in', 'Trailing off'),
    c('nar', 0, 'in', 'No audible response', { warn: 'Only for silence. Not for an answer you could not make out.' }),
    c('nod', 0, 'in', 'Nods head', { warn: GESTURE }),
    c('shk', 0, 'in', 'Shakes head', { warn: GESTURE }),
    c('ing', 0, 'in', 'Indicating (a gesture)', { warn: GESTURE }),
    c('pau', 0, 'in', 'Pause', { warn: 'Only when a long pause matters and is referred to.' }),
    c('rd', 0, 'in', 'Reads a document silently'),
    c('asr', 0, 'in', 'As read'),
    c('ph', 0, 'in', 'Phonetic (spelling not verified)', { count: 'phonetic' }),
    c('sic', 0, 'in', 'Sic (the speaker’s own error)'),
    c('for', 0, 'in', 'Foreign language spoken'),
    c('ine', 0, 'in', 'In English (answered without the interpreter)'),
    c('mic', 0, 'in', 'Microphone / audio problem'),
    c('mi', 0, 'bl', 'Recording stops'),
    c('rs', 0, 'bl', 'Recording starts again'),
    c('lau', 0, 'in', 'Laughter'),
    c('bg', 0, 'in', 'Background event'),
    c('t', 0, 'in', 'Time mark'),

    c('exm', 1, 'xh', 'Exhibit marked', { ev: 'marked' }),
    c('exmp', 1, 'xh', 'Plaintiff’s exhibit marked', { as: 'exm', ev: 'marked', set: { party: 'Plaintiff’s' } }),
    c('exmd', 1, 'xh', 'Defendant’s exhibit marked', { as: 'exm', ev: 'marked', set: { party: 'Defendant’s' } }),
    c('exmx', 1, 'xh', 'Exhibit marked, with a description', { as: 'exm', ev: 'marked', focus: 'desc' }),
    c('exmr', 1, 'xh', 'Several exhibits marked (a range)', { ev: 'marked', range: true }),
    c('exr', 1, 'xh', 'Exhibit received in evidence', { ev: 'received' }),
    c('exmr2', 1, 'xh', 'Exhibit marked and received', { ev: 'marked and received' }),
    c('exw', 1, 'xh', 'Exhibit withdrawn', { ev: 'withdrawn' }),
    c('exx', 1, 'xh', 'Exhibit refused', { ev: 'refused' }),
    c('exp', 1, 'xh', 'Exhibit previously marked', { ev: 'previously marked' }),
    c('exh', 1, 'xh', 'Exhibit handed to the witness', { ev: 'handed to witness', warn: GESTURE }),
    c('ply', 1, 'bl', 'Audio or video played'),
    c('plyx', 1, 'xh', 'Exhibit played', { ev: 'played' }),

    c('sw', 2, 'wi', 'Witness sworn', { oath: 'sworn', warn: OATH }),
    c('af', 2, 'wi', 'Witness affirmed', { oath: 'affirmed', warn: OATH }),
    c('wit', 2, 'wi', 'Witness called (oath not on the recording)', { oath: '' }),
    c('swd', 2, 'wi', 'Deposition witness sworn (set-up line)', { oath: 'sworn', warn: OATH }),
    c('int', 2, 'bl', 'Interpreter sworn / through interpreter'),
    c('suo', 2, 'wi', 'Witness still under oath', { oath: 'previously sworn', again: true }),
    c('rsm', 2, 'wi', 'Witness resumed', { oath: 'resumed', again: true }),
    c('rcl', 2, 'wi', 'Witness recalled', { oath: 'recalled', again: true }),
    c('wex', 2, 'bl', 'Witness excused', { ends: 'witness' }),
    c('wsd', 2, 'bl', 'Witness stands down', { ends: 'witness' }),
    c('jsw', 2, 'bl', 'Jury sworn'),
    c('nfq', 2, 'bl', 'No further questions', { ends: 'exam' }),

    c('dx', 3, 'ex', 'Direct examination / in chief', { col: 'Direct' }),
    c('cx', 3, 'ex', 'Cross-examination', { col: 'Cross' }),
    c('rdx', 3, 'ex', 'Redirect / re-examination', { col: 'Redirect' }),
    c('rcx', 3, 'ex', 'Recross', { col: 'Recross' }),
    c('frd', 3, 'ex', 'Further redirect', { col: 'Further redirect' }),
    c('vd', 3, 'ex', 'Voir dire', { col: 'Voir dire' }),
    c('qc', 3, 'ex', 'Examination by the court', { col: 'By the court' }),
    c('qa', 3, 'ex', 'Questions and answers start here (no heading)', { noHeading: true, col: 'Examination' }),
    c('by', 3, 'bl', 'By-line'),
    c('pe', 3, 'bl', 'Plaintiff’s / State’s evidence'),
    c('pr', 3, 'bl', 'Plaintiff / State rests'),
    c('de', 3, 'bl', 'Defendant’s evidence'),
    c('dr', 3, 'bl', 'Defendant rests'),
    c('ar', 3, 'bl', 'After recess (heading)'),

    c('j', 4, 'sp', 'Judge', { role: 'j' }),
    c('w', 4, 'sp', 'Witness', { role: 'w' }),
    c('d', 4, 'sp', 'Defendant / accused', { role: 'd' }),
    c('i', 4, 'sp', 'Interpreter', { role: 'i' }),
    c('k', 4, 'sp', 'Clerk / registrar', { role: 'k' }),
    c('r', 4, 'sp', 'Reporter', { role: 'r' }),
    c('v', 4, 'sp', 'Videographer', { role: 'v' }),
    c('ju', 4, 'sp', 'Juror', { role: 'ju' }),
    c('ch', 4, 'sp', 'Chair / arbitrator / commissioner', { role: 'ch' }),
    c('pp', 4, 'sp', 'Prosecutor', { role: 'pp' }),
    c('u', 4, 'sp', 'Unidentified speaker', { role: 'u', warn: 'Never guess who is speaking.' }),

    c('co', 5, 'bl', 'Call to order / proceedings begin'),
    c('rec', 5, 'bl', 'Recess / adjournment'),
    c('res', 5, 'bl', 'Proceedings resume'),
    c('off', 5, 'bl', 'Off the record', { warn: 'What is said off the record is not transcribed.' }),
    c('on', 5, 'bl', 'On the record'),
    c('end', 5, 'bl', 'Proceedings concluded'),
    c('pp2', 5, 'bl', 'Adjourned / postponed to a date'),
    c('msd', 5, 'bl', 'Matter stands down'),
    c('bc', 5, 'bl', 'Bench conference'),
    c('bce', 5, 'bl', 'Bench conference ended'),
    c('sb', 5, 'bl', 'Sidebar'),
    c('sbe', 5, 'bl', 'Sidebar ended'),
    c('chm', 5, 'bl', 'In chambers'),
    c('jin', 5, 'bl', 'Jury in'),
    c('jout', 5, 'bl', 'Jury out'),
    c('dp', 5, 'bl', 'Defendant present'),
    c('cam', 5, 'bl', 'Sealed / in camera starts'),
    c('came', 5, 'bl', 'Sealed / in camera ends'),
    c('rb', 5, 'bl', 'Read back'),
    c('rcl2', 5, 'bl', 'Clarification by the reporter'),
    c('vc', 5, 'bl', 'Appearing by videoconference')
  ];

  /* what each value is called when it is asked for */
  const FIELDS = {
    n: { label: 'Number or letter', hint: 'as said on the record', size: 7 },
    n2: { label: 'to', hint: 'last one', size: 7 },
    party: { label: 'Whose (optional)', hint: 'Plaintiff’s, Defendant’s…', size: 14, list: ['Plaintiff’s', 'Defendant’s', 'Government’s', 'State’s', 'Joint'] },
    desc: { label: 'Description (optional)', hint: 'a lease dated May 1, 2021', size: 26 },
    name: { label: 'Witness’s full name', hint: 'as given on the record', size: 22 },
    by: { label: 'Examining attorney', hint: 'a slot number 1-9, or a name', size: 16 },
    clock: { label: 'Time of day', hint: '11:30 a.m.', size: 10 },
    date: { label: 'Date', hint: 'as said on the record', size: 16 },
    reason: { label: 'Reason', hint: 'overlapping speakers', size: 20 },
    what: { label: 'What', hint: 'Exhibit A', size: 14 },
    lang: { label: 'Language', hint: 'Spanish', size: 12 }
  };

  const PRESETS = {
    /* ---- US court, federal format: Guide to Judiciary Policy Vol. 6 Ch. 5 § 520, AAERT samples ---- */
    'us-court': {
      name: 'US court (federal format)',
      about: 'Federal transcript format (Guide to Judiciary Policy § 520): parentheses, Q and A at the margin, by-lines, 25 numbered lines a page. State courts differ (28 lines in some): the page is yours to change.',
      time: 'hms',
      titles: { MR: 'MR.', MS: 'MS.', DR: 'DR.', ADV: 'ATTORNEY' },
      titleList: ['MR', 'MS', 'DR'],
      roles: { j: 'THE COURT', w: 'THE WITNESS', d: 'THE DEFENDANT', i: 'THE INTERPRETER', k: 'THE CLERK', r: 'THE REPORTER', v: 'THE VIDEOGRAPHER', ju: 'JUROR', ch: 'HEARING OFFICER', pp: 'PROSECUTOR', u: 'SPEAKER 1' },
      fixed: ['j', 'w'],
      qa: { layout: 'letters', q: 'Q', a: 'A', byline: 'BY {BY}:' },
      page: { lines: 25, width: 63, numbers: 'all', qText: 4, colloquy: 9, afterColon: 2, paren: 4, center: true },
      clean: 'Nothing is removed for you. Federal practice leaves out ums, uhs and stutters unless leaving them out changes the meaning: that is your call, word by word.',
      wording: {
        ina: '(inaudible)', ind: '(indiscernible)', indr: '(indiscernible - {reason})', xt: '(Simultaneous speaking.)', iv: '--', tr: '--',
        nar: '(No audible response)', nod: '(Nods head up and down)', shk: '(Shakes head from side to side)', ing: '(Indicating)', pau: '(Pause.)',
        rd: '(Silently reads {what})', asr: '(As read)', ph: '(phonetic)', sic: '[sic]', for: '(foreign language spoken)', ine: '(in English)',
        mic: '(Audio interference.)', mi: '(Recording paused.)', rs: '(Recording resumed.)', lau: null, bg: null, t: '[{time}]',
        exm: '([[{party} ]]Exhibit {n}[[, {desc},]] marked for identification.)', exmr: '([[{party} ]]Exhibits {n} to {n2} marked for identification.)',
        exr: '([[{party} ]]Exhibit {n} received in evidence.)', exmr2: '([[{party} ]]Exhibit {n} marked for identification and received in evidence.)',
        exw: '([[{party} ]]Exhibit {n} withdrawn.)', exx: '([[{party} ]]Exhibit {n} refused.)',
        exp: '(Previously marked [[{party} ]]Exhibit {n}[[, {desc},]] was introduced for examination.)', exh: '([[{party} ]]Exhibit {n} handed to the witness.)',
        ply: '(Audio played for the record.)', plyx: '([[{party} ]]Exhibit {n} was played for the jury.)',
        sw: '{NAME}, [[{PARTY} WITNESS, ]]SWORN', af: '{NAME}, [[{PARTY} WITNESS, ]]AFFIRMED', wit: '{NAME}[[, {PARTY} WITNESS]]',
        swd: '{NAME}, having been first duly sworn, was examined and testified as follows:', int: '(Interpreter sworn.)',
        suo: '{NAME}, [[{PARTY} WITNESS, ]]PREVIOUSLY SWORN', rsm: '{NAME}, [[{PARTY} WITNESS, ]]RESUMED', rcl: '{NAME}, [[{PARTY} WITNESS, ]]RECALLED',
        wex: '(Witness excused.)', wsd: '(Witness stood down.)', jsw: '(The Jury Is Sworn)', nfq: null,
        dx: 'DIRECT EXAMINATION', cx: 'CROSS EXAMINATION', rdx: 'REDIRECT EXAMINATION', rcx: 'RECROSS EXAMINATION', frd: 'FURTHER REDIRECT EXAMINATION',
        vd: 'VOIR DIRE EXAMINATION', qc: 'EXAMINATION BY THE COURT', qa: '', by: 'BY {BY}:',
        pe: 'PLAINTIFF’S EVIDENCE', pr: 'PLAINTIFF RESTS', de: 'DEFENDANT’S EVIDENCE', dr: 'DEFENDANT RESTS', ar: 'AFTER RECESS',
        co: '(Call to Order of the Court)', rec: '(Recess[[ at {clock}]].)', res: 'AFTER RECESS', off: '(Discussion off the record.)', on: '(On the record)',
        end: '(Proceedings concluded[[ at {clock}]].)', pp2: '(Proceedings adjourned to {date}.)', msd: null,
        bc: '(Bench conference on the record)', bce: '(Bench conference ended.)', sb: '(At side bar on the record)', sbe: '(End of discussion at side bar)',
        chm: '(Discussion on the record in chambers with defendant present)', jin: '(Jury in[[ at {clock}]].)', jout: '(Jury out[[ at {clock}]].)',
        dp: '(Defendant present; jury not present.)', cam: '(The following proceedings were held under seal.)', came: '(End of sealed proceedings.)',
        rb: '(The last question and/or answer was read back.)', rcl2: '(Clarification by the reporter)', vc: '(All parties appearing remotely via videoconference.)'
      },
      unsourced: ['indr', 'mi', 'rs', 'exh', 'wit', 'swd', 'suo', 'wex', 'wsd', 'qc', 'pp2', 'cam', 'came', 'bce'],
      certs: [
        { id: 'aaert', name: 'From a sound recording (neutral wording)', text: 'I certify that the foregoing is a correct transcript from the electronic sound recording of the proceedings in the above-entitled matter.' },
        { id: 'fed', name: 'Federal: court approved transcriber', needs: 'I am approved as a transcriber by this court', text: 'I, court approved transcriber, certify that the foregoing is a correct transcript from the official electronic sound recording of the proceedings in the above-entitled matter.' }
      ],
      cover: ['Court', 'District', 'Case name', 'Docket number', 'Before (judge and title)', 'Type of proceeding', 'Date and time', 'Transcribed by']
    },

    /* ---- US deposition: NCRA baseline, Steno's contractor quicklist ---- */
    'us-depo': {
      base: 'us-court',
      name: 'US deposition',
      about: 'Deposition style on the NCRA baseline: one exhibit series, CROSS-EXAMINATION with its hyphen, by-lines. The officer’s certificate (witness duly sworn, read and sign) belongs to the officer who took the deposition and is never offered here.',
      roles: { j: 'THE COURT', w: 'THE WITNESS', d: 'THE DEFENDANT', i: 'THE INTERPRETER', k: 'THE NOTARY', r: 'THE REPORTER', v: 'THE VIDEOGRAPHER', ju: 'JUROR', ch: 'HEARING OFFICER', pp: 'PROSECUTOR', u: 'SPEAKER 1' },
      fixed: ['w', 'r'],
      page: { lines: 25, width: 63, numbers: 'all', qText: 4, colloquy: 9, afterColon: 2, paren: 9, center: true },
      wording: {
        ph: '(ph)', exm: '([[{party} ]]Exhibit {n}[[, {desc},]] was marked for identification.)', exmr: '(Exhibits {n} to {n2} were marked for identification.)',
        exr: '([[{party} ]]Exhibit {n} was received into evidence.)', exmr2: '([[{party} ]]Exhibit {n} was marked for identification and received into evidence.)',
        cx: 'CROSS-EXAMINATION', rcx: 'RECROSS-EXAMINATION', off: '(An off-the-record discussion was held)', on: '(On the record)',
        rec: '(A recess was taken[[ at {clock}]].)', end: '(Deposition concluded[[ at {clock}]].)',
        rb: '(The last question and answer were read back by the reporter)', co: null, jsw: null, jin: null, jout: null, dp: null, bc: null, bce: null, sb: null, sbe: null, chm: null,
        pe: null, pr: null, de: null, dr: null, plyx: '(Exhibit {n} was played for the record.)'
      },
      unsourced: ['indr', 'mi', 'rs', 'exh', 'wit', 'swd', 'suo', 'wex', 'wsd', 'qc', 'pp2', 'cam', 'came', 'end', 'rcx', 'plyx', 'rec'],
      certs: [
        { id: 'aaert', name: 'From a sound recording (neutral wording)', text: 'I certify that the foregoing is a correct transcript from the electronic sound recording of the proceedings in the above-entitled matter.' }
      ],
      cover: ['Court', 'Case name', 'Case number', 'Deposition of', 'Date', 'Location', 'Transcribed by']
    },

    /* ---- US company style: Rev's legal style guide for its transcribers ---- */
    'us-company': {
      base: 'us-depo',
      name: 'US company style (Rev-like)',
      about: 'The style platforms give their transcribers: square tags with the time, [inaudible 00:12:34]; a closed list of parentheticals; questions and answers marked, with no headings, swear-in lines or by-lines (the company adds those). Colloquy only for police interviews, IMEs, insurance interviews and board meetings.',
      fixed: ['j', 'w'],
      roles: { j: 'THE COURT', w: 'THE WITNESS', d: 'THE DEFENDANT', i: 'THE INTERPRETER', k: 'THE CLERK', r: 'THE REPORTER', v: 'THE VIDEOGRAPHER', ju: 'JUROR', ch: 'ARBITRATOR', pp: 'PROSECUTOR', u: 'SPEAKER 1' },
      qa: { layout: 'letters', q: 'Q', a: 'A', byline: '' },
      wording: {
        ina: '[inaudible {time}]', ind: '[inaudible {time}]', indr: null, xt: '[crosstalk {time}]', nar: '(No audible response).', ph: '(phonetic)', sic: '(sic)',
        nod: null, shk: null, ing: null, pau: null, rd: null, asr: null, mic: '[inaudible {time}]', mi: null, rs: null,
        exm: '(Exhibit {n} was marked for identification.)', exmr: '(Exhibits {n} to {n2} were marked for identification.)', exr: '(Exhibit {n} was received into evidence.)',
        exmr2: null, exw: null, exx: null, exp: null, exh: null, ply: '(Audio played for the record.)', plyx: '(Exhibit {n} was played for the jury.)',
        sw: null, af: null, wit: null, swd: null, suo: null, rsm: null, rcl: null, wex: null, wsd: null, jsw: null, int: null,
        dx: null, cx: null, rdx: null, rcx: null, frd: null, vd: null, qc: null, by: null, ar: null, res: null,
        co: null, rec: '(A recess was taken.)', off: '(Discussion off the record.)', on: null, end: null, pp2: null,
        bc: '(Bench conference held out of the hearing of the jury.)', bce: '(Bench conference ended.)', sb: null, sbe: null, chm: null,
        jin: '(Jury entered the courtroom.)', jout: '(Jury exited the courtroom.)', dp: null, cam: null, came: null,
        rb: '(The requested question was read back.)', rcl2: null, vc: null
      },
      unsourced: ['xt', 'mic'],
      certs: [],
      cover: []
    },

    /* ---- South Africa, court: real High Court transcripts (Veritas, Lepelle Scribes) and the court rules ---- */
    'sa-court': {
      name: 'South Africa court',
      about: 'From real High Court transcripts: named speakers in capitals with no full stop after MR or ADV, square tags with a leading ellipsis, court events as lines in capitals, every tenth line numbered. Verbatim: nothing is tidied.',
      time: 'hms',
      titles: { MR: 'MR', MS: 'MS', DR: 'DR', ADV: 'ADV' },
      titleList: ['MR', 'MS', 'ADV', 'DR'],
      roles: { j: 'COURT', w: 'WITNESS', d: 'ACCUSED', i: 'INTERPRETER', k: 'CLERK', r: 'REGISTRAR', v: 'OPERATOR', ju: 'ASSESSOR', ch: 'CHAIRPERSON', pp: 'PROSECUTOR', u: 'UNIDENTIFIED SPEAKER' },
      fixed: ['j', 'w'],
      qa: { layout: 'named', q: 'Q', a: 'A', byline: '', dash: ' --- ' },
      inline: ['exm', 'exmr'], // an exhibit is named in capitals inside the sentence, not on a line of its own
      page: { lines: 30, width: 63, numbers: 'tens', qText: 4, colloquy: 0, afterColon: 1, paren: 0, center: false },
      clean: 'Verbatim. South African certificates state that no syntax or grammar was altered, so nothing is removed or tidied.',
      wording: {
        ina: '[inaudible]', ind: '...[indistinct]', indr: '...[indistinct - {reason}]', xt: '[speaking simultaneously]', iv: '...[intervenes]', tr: '...[incomplete]',
        nar: '[no audible reply]', nod: '(Witness nods)', shk: '(Witness shakes head)', ing: '(Witness indicates)', pau: '[pause]',
        rd: '[witness reads {what}]', asr: '[as read]', ph: '(phonetic)', sic: '[sic]', for: '[speaking in vernacular]', ine: null,
        mic: '[Microphone not switched on - {time}]', mi: '[mechanical interruption]', rs: '[recording resumes]', lau: '[laughter]', bg: '[{what}]', t: '[{time}]',
        exm: 'EXHIBIT {n}', exmr: 'EXHIBITS {n} TO {n2}', exr: 'EXHIBIT {n} HANDED IN', exmr2: null, exw: 'EXHIBIT {n} WITHDRAWN', exx: 'EXHIBIT {n} REFUSED',
        exp: null, exh: '(Document handed to witness)', ply: '[recording played]', plyx: '[EXHIBIT {n} played]',
        sw: '{NAME}: duly sworn states.', af: '{NAME}: duly affirmed states.', wit: '{NAME}:', swd: null, int: '(through interpreter)',
        suo: '{NAME}: s.u.o.', rsm: '{NAME}: s.u.o.', rcl: '{NAME}: recalled, s.u.o.', wex: 'WITNESS EXCUSED', wsd: 'WITNESS STANDS DOWN', jsw: null,
        nfq: 'NO FURTHER QUESTIONS BY {BY}',
        dx: 'EXAMINATION BY {BY}:', cx: 'CROSS-EXAMINATION BY {BY}:', rdx: 'RE-EXAMINATION BY {BY}:', rcx: null, frd: 'FURTHER EXAMINATION BY {BY}:',
        vd: 'TRIAL WITHIN A TRIAL', qc: 'QUESTIONS BY THE COURT:', qa: '', by: null,
        pe: 'STATE CASE', pr: 'CASE FOR THE STATE CLOSED', de: 'DEFENCE CASE', dr: 'CASE FOR THE DEFENCE CLOSED', ar: 'ON RESUMPTION:',
        co: 'PROCEEDINGS ON {DATE}[[ [{clock}]]]', rec: 'COURT ADJOURNS:[[ [{clock}]]]', res: 'COURT RESUMES:[[ [{clock}]]]', off: '[off the record]', on: '[on the record]',
        end: 'COURT ADJOURNS[[ [{clock}]]]', pp2: 'MATTER IS POSTPONED TO {DATE}', msd: 'MATTER STANDS DOWN',
        bc: null, bce: null, sb: null, sbe: null, chm: 'IN CHAMBERS', jin: null, jout: null, dp: null, cam: 'IN CAMERA', came: 'END OF IN CAMERA PROCEEDINGS',
        rb: '[record replayed]', rcl2: null, vc: '[all parties appearing by video link]'
      },
      unsourced: ['indr', 'xt', 'tr', 'nar', 'nod', 'shk', 'ing', 'pau', 'rd', 'asr', 'ph', 'sic', 'for', 'mi', 'rs', 'exmr', 'exr', 'exw', 'exx', 'exh', 'ply', 'plyx',
        'af', 'wit', 'rsm', 'rcl', 'wex', 'wsd', 'nfq', 'cx', 'rdx', 'frd', 'vd', 'qc', 'pe', 'pr', 'de', 'dr', 'ar', 'off', 'on', 'msd', 'chm', 'cam', 'came', 'rb', 'vc'],
      certs: [
        { id: 'sa', name: 'Transcriber’s certificate (as far as it is audible)', text: 'I, the undersigned, hereby certify that so far as it is audible to me, the aforegoing is a true and correct, verbatim transcript of the proceedings recorded by means of a digital recorder in the matter named above.' },
        { id: 'sa-private', name: 'Private work: transcribed from a recording supplied to me', text: 'I, the undersigned, hereby certify that so far as it is audible to me, the aforegoing is a true and correct, verbatim transcript of the digital recording supplied to me in the matter named above.' }
      ],
      cover: ['Court and division', 'Case number', 'Date', 'Matter', 'Before', 'On behalf of', 'Interpreters', 'Transcribed by']
    },

    /* ---- South Africa, hearings: commissions, inquiries, CCMA and disciplinary hearings ---- */
    'sa-hearing': {
      base: 'sa-court',
      name: 'South Africa hearing (CCMA / disciplinary)',
      about: 'The court layout as commissions and inquiries use it, with CHAIRPERSON or COMMISSIONER in the chair and HEARING ADJOURNS. No published CCMA format was found: this follows real inquiry transcripts and one 2026 request for quotation (fuller verbatim, with [laughs] and [sighs]).',
      roles: { j: 'CHAIRPERSON', w: 'WITNESS', d: 'EMPLOYEE', i: 'INTERPRETER', k: 'SECRETARY', r: 'EMPLOYER REPRESENTATIVE', v: 'EMPLOYEE REPRESENTATIVE', ju: 'PANEL MEMBER', ch: 'COMMISSIONER', pp: 'INITIATOR', u: 'UNIDENTIFIED SPEAKER' },
      wording: {
        lau: '[laughs]', co: 'PROCEEDINGS ON {DATE}[[ [{clock}]]]', rec: 'HEARING ADJOURNS[[ [{clock}]]]', res: 'HEARING RESUMES[[ [{clock}]]]',
        end: 'HEARING ADJOURNS[[ [{clock}]]]', pp2: 'HEARING ADJOURNS UNTIL {DATE}', qc: 'QUESTIONS BY THE CHAIRPERSON:', pe: 'EMPLOYER’S CASE', pr: 'EMPLOYER’S CASE CLOSED',
        de: 'EMPLOYEE’S CASE', dr: 'EMPLOYEE’S CASE CLOSED', vd: null, chm: null
      },
      unsourced: ['indr', 'xt', 'tr', 'nar', 'nod', 'shk', 'ing', 'pau', 'rd', 'asr', 'ph', 'sic', 'for', 'mi', 'rs', 'exmr', 'exr', 'exw', 'exx', 'exh', 'ply', 'plyx',
        'af', 'wit', 'rsm', 'rcl', 'wex', 'wsd', 'nfq', 'cx', 'rdx', 'frd', 'qc', 'pe', 'pr', 'de', 'dr', 'ar', 'off', 'on', 'msd', 'cam', 'came', 'rb', 'vc', 'res'],
      cover: ['Forum', 'Case number', 'Date', 'Matter', 'Chairperson / commissioner', 'For the employer', 'For the employee', 'Transcribed by']
    },

    /* ---- UK: one 2006 High Court transcript and one 2026 public inquiry transcript; no public style manual exists ---- */
    'uk': {
      name: 'UK',
      about: 'From two real transcripts (High Court 2006, a public inquiry 2026): Q. and A., names without full stops, parentheses for everything, clock times on their own line. No official style guide is public, and no certificate wording was found.',
      time: 'hms',
      titles: { MR: 'MR', MS: 'MS', DR: 'DR', ADV: 'COUNSEL' },
      titleList: ['MR', 'MS', 'DR'],
      roles: { j: 'THE JUDGE', w: 'THE WITNESS', d: 'THE DEFENDANT', i: 'THE INTERPRETER', k: 'THE CLERK', r: 'THE USHER', v: 'THE ASSOCIATE', ju: 'THE FOREMAN', ch: 'THE CHAIR', pp: 'PROSECUTION', u: 'UNIDENTIFIED SPEAKER' },
      fixed: ['j', 'w'],
      qa: { layout: 'letters', q: 'Q.', a: 'A.', byline: '' },
      page: { lines: 25, width: 63, numbers: 'all', qText: 4, colloquy: 0, afterColon: 2, paren: 0, center: false },
      clean: 'Nothing is removed for you.',
      wording: {
        ina: '(inaudible)', ind: '(unclear)', indr: null, xt: '-- (overspeaking) --', iv: '--', tr: '--', nar: '(No audible reply)', nod: '(The witness nodded)',
        shk: '(The witness shook their head)', ing: '(Indicating)', pau: '(Pause)', rd: '(Pause while reading {what})', asr: '(As read)', ph: '(phonetic)', sic: '(sic)',
        for: '(foreign language spoken)', ine: null, mic: '(witness is off the microphone)', mi: '(Recording stopped)', rs: '(Recording resumed)', lau: '(Laughter)', bg: null, t: '({clock})',
        exm: null, exmr: null, exr: null, exmr2: null, exw: null, exx: null, exp: null, exh: '(Handed)', ply: '(Recording played)', plyx: null,
        sw: '{NAME} (SWORN)', af: '{NAME} (AFFIRMED)', wit: '{NAME}', swd: null, int: '(Interpreter sworn)', suo: null, rsm: null, rcl: '{NAME} (recalled)',
        wex: '(The witness withdrew)', wsd: '(The witness stood down)', jsw: '(Jury sworn)', nfq: null,
        dx: 'EXAMINATION-IN-CHIEF BY {BY}', cx: 'CROSS-EXAMINATION BY {BY}', rdx: 'Re-examined by {BY}', rcx: null, frd: null, vd: null, qc: 'Questions from THE CHAIR', qa: '', by: null,
        pe: null, pr: null, de: null, dr: null, ar: null,
        co: '({clock})', rec: '(A short break)', res: '({clock})', off: null, on: null, end: '(The hearing adjourned[[ until {date}]])', pp2: '(The hearing adjourned until {date})', msd: null,
        bc: null, bce: null, sb: null, sbe: null, chm: '(In chambers)', jin: null, jout: '(In the absence of the jury)', dp: null, cam: '(In private)', came: '(In open court)',
        rb: null, rcl2: null, vc: null
      },
      unsourced: ['ind', 'nar', 'shk', 'ing', 'ph', 'sic', 'for', 'mi', 'rs', 'lau', 'exh', 'ply', 'wit', 'int', 'rcl', 'wex', 'wsd', 'jsw', 'rdx', 'qc', 'end', 'pp2', 'chm', 'jout', 'cam', 'came', 'rd'],
      certs: [],
      cover: ['Case No', 'Court', 'Date', 'Before', 'Between', 'Appearances', 'Transcribed by']
    }
  };
  const ORDER = ['us-company', 'us-court', 'us-depo', 'sa-court', 'sa-hearing', 'uk'];
  const DEFAULT = 'us-company';

  const api = { GROUPS, CATALOG, FIELDS, PRESETS, ORDER, DEFAULT };
  root.LegalPresets = api; if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
