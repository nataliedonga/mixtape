/* The style guides Claude works to: its bible. One for legal transcripts (TranscribeMe's guidelines) and one for all
   other transcripts (Rev's style guide). Her choice (2026-11-26); to be updated as they go.

   Written in Mixtape's own words from the companies' published guides, read 16 November 2026:
   TranscribeMe's TM Library (tm-library.helpscoutdocs.com) and Rev's transcription guide
   (sites.google.com/rev.com/revlegaltranscription). Where a guide was silent, that is said, and Mixtape's choice is
   marked "Mixtape:". Update a guide here and every transcript after it follows the new rules. */

export const TRANSCRIBEME = `STYLE GUIDE: TranscribeMe (used for LEGAL transcripts)

1. Speakers
- Every new speaker starts a new line. Each person keeps the same label from start to end.
- TranscribeMe's QA team sets the labels and its pages give no format. Mixtape: in a legal transcript, use the person's name as given in the proceedings ("Judge Mokoena", "Ms. Pillay", "Mr. Botha"), else their role ("Judge", "Witness", "Counsel for the plaintiff", "Counsel for the defendant", "Interpreter", "Clerk"), else "Speaker 1", "Speaker 2". Never guess a name.

2. Clean verbatim (the default)
- Fillers (uh, um, mm-hmm) come out, unless one is the whole answer to a direct question.
- Feedback words alone on a line ("Right", "Yeah", "Okay") come out when nobody responds to them.
- Only two crutch phrases come out, and only when they add nothing: "like" and "you know". "Sort of", "kind of", "I mean", "I guess" stay.
- False starts: three words or fewer before the break come out; four or more stay. Deliberate repetition stays.
(These removals are made by Mixtape's style rules, which hide the words without deleting them. Do not remove words yourself.)

3. Full verbatim (when asked for)
- Everything the main speakers say is kept: fillers, feedback words, false starts, stutters, repetitions.
- Spellings: uh, ah, um, hmm; uh-huh, mm-hmm; uh-uh, mm-mm; yeah; okay.

4. Punctuation
- Standard sentence punctuation. A question mark on every question, including a statement said as a question.
- A false start or broken-off speech: two hyphens straight after the broken word, then a space: "I went to the-- we drove there". Speech cut off by another speaker ends with "--", and the speaker who cut in starts on a new line.
- A stutter: a single hyphen joins the repeats ("I-I'm", "g-g-going").
- Fillers, and "like" / "you know" used as fillers, are set off with commas: "So, um, I went".
- A single word repeated takes commas: "I, I, I went".
- "gonna", "wanna", "kinda" may stay in full verbatim; "-ing" endings and "them" are written in full.
- No exclamation marks unless the words are clearly shouted. No ellipses.

5. Capitals
- The first word of a sentence, names of people, places and organisations, "I", days and months.
- Mixtape: titles used with a name or as a form of address ("Your Honour", "Judge", "Counsel" when addressed); "the Court" with a capital when it means the judge.

6. Tags (lower case, in square brackets)
- [inaudible]: words that cannot be made out or guessed. [word?]: a guess, with a question mark. [crosstalk]: another main speaker talks over this one so the words are lost (the cut lines end and begin with --). [foreign]: speech in another language. [laughter]: never on its own line. [silence]: ten seconds or more, on its own line. [music], [applause] when relevant.
- Tags are placed by the person checking the recording, who can hear it. Claude does not add them.

7. Legal notations (TranscribeMe's pages give no wording for these; Mixtape:)
- In parentheses, sentence case, full stop inside, on their own line, only where the words clearly show the event:
  (The witness was sworn.) (Exhibit 4 was marked for identification.) (Exhibit 4 was received into evidence.)
  (A recess was taken.) (Off the record.) (Back on the record.)
- Use the exhibit's own number or letter as said. Never put one in on a guess.

8. Numbers: not in the pages read. Mixtape: leave number words as said; Mixtape's style rules handle digits.`;

export const REV = `STYLE GUIDE: Rev (used for all transcripts that are not legal)

1. Speakers
- A new speaker label each time the speaker changes; the same person keeps the same label throughout.
- The person's full name when the recording gives it; otherwise a role that is clear from the conversation ("Interviewer", "Caller", "Agent", "Host"); otherwise "Speaker 1", "Speaker 2". Never guess a name.
- A new paragraph when a speaker turns to address someone else, and after "strike that". Not for a short pause.

2. Verbatim
- Kept: every full word, false starts, repeated full words, "like", "you know", "yeah", "yep", "ain't".
- Left out: "um", "uh", cut-off part-words and stutters, coughs and laughs, a brief "excuse me".
- "mm-hmm" / "uh-huh": kept when it answers a question; otherwise left out.
- Informal forms are written out: gonna = going to, kinda = kind of, gotta = got to, 'cause = because, 'em = them, coulda = could have, 'til = until. Ordinary contractions (I've, haven't) stay. Grammar is not corrected.
(Removals and written-out forms are made by Mixtape's style rules, which hide or restyle words without deleting them. Do not change words yourself.)

3. Punctuation
- Standard sentence punctuation with the Oxford comma ("red, white, and blue").
- No exclamation marks. No ellipses. No em dashes.
- A false start, an interruption or speech that trails off: a double dash with a space on each side, " -- ", and no other mark beside it: "I went to the -- we drove there".
- Commas around a person addressed: "Yes, sir, please do." "Thank you, Doctor."
- Commas around "you know" and "like" when they are fillers.
- A statement that asks for confirmation takes a question mark: "You were there that night?"
- A tag question of one or two words follows a comma ("You saw him, correct?"); of three words or more, a semicolon ("You saw him; is that accurate?").

4. Capitals
- The first word of a sentence, names, places, organisations, "I".
- Titles in direct address: "Doctor", "Officer", "Counsel", "Your Honor".
- "Court" with a capital only when it means the judge of this proceeding.
- Specific numbered items: "Exhibit 2", "Page 15", "Paragraph 3", "Line 6".

5. Numbers (applied by Mixtape's style rules; for reference)
- "Which one" numbers in digits, even at the start of a sentence (Exhibit 2, Page 15, grade 7).
- "How many": zero to ten in words, 11 and up in digits, words at the start of a sentence. Indefinite amounts in words ("a hundred times").
- Money in digits with $ only when "dollars" is said; "percent" as a word; years in digits.

6. Parentheticals (only these, in sentence case, full stop inside)
- [inaudible 00:30:00] with the time, in square brackets (placed by the person checking).
- (Exhibit 3 was marked for identification.) (Exhibit 3 was received into evidence.) (A recess was taken.) (Bench conference held.) (Bench conference ended.) (Audio recording played.) (Video recording played.) (No audible response) (phonetic) after an unverifiable name, the first time only.
- Outside legal work these are rarely needed. Mixtape: an ordinary transcript may take a short parenthetical for an event that matters to reading it, such as (Call transferred.) or (Recording paused.).`;

export const guideFor = legal => (legal ? TRANSCRIBEME : REV);
