# Mixtape

An offline music player for your own songs, with a studio for mixing, scoring to picture and transcribing, all in the browser.

**[Open Mixtape](https://nataliedonga.github.io/mixtape/)** · installs on a phone and keeps playing with the screen off

![Mixtape Studio with its demo groove loaded: drums, bass and piano tracks on a timeline, with per-track volume, pan and effects](docs/studio.png)

## What it does

- **Player:** your own song files, saved on your device and never uploaded. Queue, playlists, favourites, search, shuffle and repeat, sleep timer, speed, lock-screen controls. Reads title, artist, album and cover art from MP3 tags.
- **Studio:** cut and arrange parts on a timeline, mix with per-track EQ, compression, sends and groups, drum machine, MIDI and synthesised instruments, and an orchestra of CC0 samples.
- **Scoring to picture:** a picture track, hit points, a tempo map that fits the cuts, and finished mixes delivered to broadcast and streaming loudness standards (EBU R128, -23 LUFS).
- **Reader:** open a PDF to read it, mark it up, fill in its forms and sign it, then save back into the same file.
- **Lyrics and transcripts:** speech recognition runs in the browser (Whisper through transformers.js) to time lyrics line by line, transcribe interviews, find the speakers, and match a read script to its recording word by word.

Everything runs on the device. The only exception is an optional AI check of a transcript, which is switched off for anything marked sensitive.

When you change `index.html`, bump `VERSION` in `sw.js` so installed copies pick up the update.

Designed, specified and tested by Natalie Donga; built with Claude Code.

## Privacy

Mixtape contacts no server except the one it is served from. Fonts (`vendor/fonts/`, SIL Open Font License) and the speech recogniser with its models (`vendor/asr/`: transformers.js, Apache-2.0; ONNX Runtime Web, MIT; Whisper, MIT; pyannote segmentation, MIT; Wespeaker, Apache-2.0) are part of the app. Every page carries a Content-Security-Policy that makes the browser refuse any other connection. Songs, recordings, documents and transcripts stay in the browser on your device.

## Lyrics

Any song can carry its lyrics (song menu → **Add lyrics**). In **Now Playing → Lyrics** the line being sung lights up and stays in view; tap a line to jump there.

- Paste the words, or load a `.lrc`, `.srt`, `.vtt` or `.txt` file.
- **Time them automatically**: the song is heard by Whisper (base.en, MIT) running in the browser through transformers.js 4.3.1 (Apache-2.0) and ONNX Runtime Web (MIT), all served by Mixtape itself (`vendor/asr/`); your lines are matched to what it hears. Lines it is unsure of are marked *check*. The model (~77 MB) is fetched from Mixtape's own site once, on first use, and kept. If the song has a split vocals stem, that is what it listens to.
- **Tap along**: play the song and press Space as each line starts (Backspace takes a tap back).
- Save the timed lyrics as `.lrc`, `.srt` (YouTube, video editors) or `.vtt`.

Rules: `lyrics-core.js` (checked by `node lyrics-check.cjs`); screens: `lyrics.js`, `lyrics.css`; recogniser: `asr-worker.js`.

## Transcripts and read-along

**Transcribe** (top bar, the song menu, or the Studio): pick a recording or video, or open a file (it joins the library under *Recordings*).

- **Write down what is said**: for interviews and voice notes. The text appears as it is made, in paragraphs at the pauses.
- **Match my text to it**: for audiobooks and read scripts. Paste the text or load a .txt; each word is matched to the moment it is read (headings the narrator skips, misread names and asides do not throw it).
- Click any word to play from there; the word being spoken is lit and kept in view. Double-click a word (or ✎) to correct its paragraph: words you keep keep their timing.
- **Speakers are found automatically** (pyannote segmentation 3.0, MIT, hears the turns; Wespeaker ResNet34, Apache-2.0, tells the voices apart, both in `speaker-worker.js`). Click a speaker to rename them everywhere, or give a paragraph to someone else or a new speaker.
- **Everything said is kept** — "um", "uh", "we, we" (Whisper is prompted to write verbatim). **Clean script** hides fillers, false starts and starters ("So,", "Well,", "You know,"); exports follow the switch.
- **Words the recogniser was unsure of are lighter** (from Whisper's own token probabilities), the least sure underlined: check those first.
- Keys, as in Temi and Rev: **Tab** play/pause anywhere (even while typing), **Shift+Tab** back 5 s, Ctrl+←/→ 5 s, Ctrl+↑/↓ speed, Ctrl+Z undo, Ctrl+F find, ? for the list. Playing again after a pause backs up 1 s.
- **✦ AI check** (inside the studio only, it goes through the studio's server): a second reader. Claude (Opus 5.5) reads the transcript for sense and suggests the words the recogniser most likely misheard (names, places, legal or local words, sound-alikes) and paragraphs whose speaker looks wrong, and who a speaker is when the talk says so. Optional notes (names, the topic) help it spell. It never rewrites: the server drops any suggestion that rewords, adds or removes a filler, or does not match the words actually there. Each shows as an ochre mark: hear it, accept it, or keep what was heard; Accept all and Ctrl+Z work. About $0.07 per 1,000 words, costed to the studio.
- **Mark sensitive** (under the title): for court, client, medical or HR recordings. The AI check is locked (it is the only thing here that sends anything out: the words, to Claude through the studio), the recording shows a 🔒, exports say so, and it is never used for training. Recognising, speakers, cutting and exports always run in the browser.
- A transcript made elsewhere (a `.json` with `"mode": "heard"`, e.g. from Reverb on your own computer) opens with its recording as a transcript.
- Long recordings are read 30 seconds at a time and saved as they go: pause, close, and continue later.
- Save as text with timestamps, plain text, .srt, .vtt, or words with times (.json).

Rules: `transcript-core.js` (checked by `node transcript-check.cjs`); screen: `transcribe/`. Same recogniser as the lyrics.

## Reader

**Reader** (top bar): documents read on this computer, and PDFs marked up, rearranged and redacted. Nothing is ever uploaded.

- Open with **Open…** (Ctrl+O), by dropping a file on the page, from **Recent** (the last 20 documents you opened, found again where they were), or, in the installed app, by opening a `.pdf` with Mixtape.
- Several documents at once, PDFs and others alike, each in its own tab (arrow keys walk the tabs).

**PDFs**

- **Annotate**: highlight, underline, strike out, squiggly, notes, free text, drawing. **Shapes**: boxes, circles, lines, arrows, polygons. **Insert**: images and stamps. **Form**: fill in a PDF's form fields, and sign.
- **Saved as you go**: every change is written into the same file as you make it (the browser asks once to allow it). Undo (Ctrl+Z) takes a change back and the file follows. **Back to original** puts the file back byte for byte as it was when opened here. Untick **Save as I go** to save only with **Save** (Ctrl+S). **Save a copy…** (Ctrl+Shift+S) asks where. Password-protected and permission-protected PDFs keep their protection.
- **Pages…**: turn, delete, reorder (drag the thumbnails, or Alt+arrows), add the pages of other PDFs (merge), **Extract…** the selected pages to a new PDF, **Split…** into several new PDFs. Nothing changes until **Apply to document**; then it is saved like any other change, Ctrl+Z or the Undo in the message takes it back, and Back to original still works. Extract and Split always write new files. A deleted page is removed from the file, not hidden, and its bookmark goes with it. Not for password-protected PDFs; fillable fields in pages added from another PDF become plain.
- **Redact…**: drag a box over what must go, or find words and **Black out every match**. The text, pictures, drawings, notes, links and form fields under a box are removed from a copy, not covered; the same words are taken out of the document's title, information and bookmarks. Then the copy is checked before it can be saved: it is opened again and all its text searched, every part of the file is unpacked and searched, every box is looked at for letters left behind and must be solid black. Only then does it say *Checked: none of the N blacked-out passages can be found in the new file* and offer **Save the redacted copy…**; otherwise it says what was found and saves nothing. The document you have open is never changed. A page that is turned sideways, or where something under a box cannot be cut out, becomes a picture of itself (the report says which; its words can no longer be selected). Not for password-protected PDFs. The check finds the passages you blacked out, not other spellings of them: it tells you when a word from a passage still appears elsewhere.
- **Safeguards**: a file changed by another program while open here is not saved over (the header says so; Save asks first). The same file opens once, not in two tabs. A tab closed with changes that are not in a file offers *Save a copy…* and *Open it again*. Each save is this document's own, whichever tab is in front.

**Word, ebooks, screenplays, Markdown, Rich Text, OpenDocument, plain text** (`.docx`, `.epub`, `.fountain`, `.md`, `.rtf`, `.odt`, `.txt`)

- Open in a reading view: one comfortable column, **A− / A+** text size, light or dark page, **Find** (Ctrl+F, Enter for the next), **Contents** from the headings (scenes for a screenplay, the book's own contents for an ebook), and **Save as PDF…** (Ctrl+P) through the browser's print. They are opened for reading only: the file is never changed.
- Shown for reading, not as printed: a Word, Rich Text or OpenDocument file keeps its words, headings, lists, tables, pictures and links but not its page layout, fonts, columns, headers and footers or tracked changes; an ebook is one long page in the Reader's own type; Rich Text pictures and footnotes are not shown. The note above the document says so. Old Word `.doc` files and copy-protected (DRM) ebooks are not read.
- **A document is treated as untrusted.** Only plain reading elements are copied onto the page (an allow-list: no scripts, no hidden instructions such as `onerror=`, no `javascript:` or `data:` links, no forms or frames, none of the document's own styles), and it is shown inside a frame in which the browser runs no scripts at all. Pictures inside the file are shown; pictures and style sheets that live on the internet are never fetched. What was left out is counted and said above the document (“2 pictures that live on the internet were not loaded”). Zip-based files (`.docx`, `.odt`, `.epub`) are refused if they would unpack into more than 300 MB, hold more than 5,000 parts, or lie about their size (zip bombs).

**Privacy**: the page's Content-Security-Policy makes the browser refuse every connection except to the app's own files. A link inside a document is only opened after you agree, and only web and email addresses. Recent can drop one entry or be cleared.

Built on EmbedPDF 2.15.1 (MIT) running PDFium (BSD/Apache-2.0) in WebAssembly, with Noto Sans (OFL), in `vendor/embedpdf/`; pdf-lib 1.17.1 (MIT) for page tools and for writing the redacted copy, in `vendor/pdf-lib/`; mammoth 1.13.0 (BSD-2-Clause) for Word, in `vendor/mammoth/`; marked 18.2.0 (MIT) for Markdown, in `vendor/marked/`. Fountain, Rich Text, OpenDocument, ePub and zip are read by the Reader's own code. Nothing is fetched from the internet.

Coming next: reading scanned pages (OCR); read-along with a recording.

Screen: `reader/`.

**Where it lives:** this repository is carried inside screenwright as `apps/mixtape` and served there at `/studio/mixtape/` (behind staff sign-in). Pushing to `main` still publishes the phone version on GitHub Pages. Edit it in `screenwright/apps/mixtape`.
