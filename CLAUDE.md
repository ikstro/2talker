# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

2Talker (first called tu-talk): a Windows tray app (Electron) that translates a picked text offline and reads the English aloud. A sibling of the Language Tutor in `ikstro/cc-translator` (`E:\Cursor\Plugin\CC-translator`): the card's webview, the natural voice, the system voice and the word dictionary were copied from its `panel/` and adapted; the two repositories do not share code at build time.

## Commands

```
npm install
npm test                          # vitest
npx vitest run src/translate.test.ts
npm run typecheck
npm run build                     # esbuild: dist/main.js, preload.js, mt-worker.js, voice-worker.js; media/card.js; codicons into media/
npm start                         # build + electron .
npm run dist                      # electron-builder → release/2Talker-Setup-<version>.exe (NSIS, win-x64)
npm run icons                     # build/icon.svg → build/icon.png (512) and media/icon.png (128, the tray), rendered by Electron
npm run models                    # scripts/build-mt.mjs: src/mt-manifest.json + vendor/bergamot from Mozilla
```

Release: bump `version` in package.json, commit, tag `v<version>`, push the tag. `.github/workflows/release.yml` builds the installer on windows-latest and publishes the GitHub release with `latest.yml`; installed copies update from it (`src/update.ts`, electron-updater, checked at start and every 6 h, installed on quit). The installer is unsigned.

A shell started from VS Code or Claude Code may carry `ELECTRON_RUN_AS_NODE=1`; Electron then runs as plain Node and `electron.app` is undefined. Run with it unset (`env -u ELECTRON_RUN_AS_NODE …`).

## Architecture

Main process (`src/main.ts`): tray, the card window, the app window, flows. `%APPDATA%\2Talker\`: `settings.json` (`settings.ts`), `models\<code>\` (translator), `voice\` (Kokoro), `dict\`; `words.json` (`words.ts` `WordStore`: the notebook, one entry per dictionary form; `ankiTsv` for Anki's import); `adoptOldFolder` moves them over from `%APPDATA%\tu-talk` once. Closing the card (`hideCard`: Esc, ✕, a click elsewhere) also sends `stop` to the card, which plays the natural voice's audio itself.

- **Selected text**: `winclip.ts` registers the card window as a clipboard listener (user32 through koffi; `WM_CLIPBOARDUPDATE` via `hookWindowMessage`). `clipboard.ts` `DoubleCopy`: two changes 40–650 ms apart with Ctrl held = a request (`doubleCopy` setting); changes closer than 40 ms are one copy announced in several formats. Copies made inside the focused card are ignored. The selection shortcut (`selectKey`, none by default) waits until its keys are let go, presses Ctrl+C in the program in front (`pressCopy`, `keybd_event`) and takes the next clipboard change within 600 ms (`copyWanted`). `registerShortcuts()` registers it and `snipKey`; either may be empty.
- **Screenshot**: the snip shortcut (`snipKey`, default Ctrl+Alt+S) opens `ms-screenclip:` (Windows' snipping overlay); the next picture on the clipboard within two minutes is the snip (`clipboard.read()`, `image/png`; Electron 45's clipboard API is async). `ocr.ts` runs `Windows.Media.Ocr` through Windows PowerShell (`-EncodedCommand`, never `-ExecutionPolicy`), the person's language engine first (it reads Latin too), then English; `ocrtext.ts` joins lines into paragraphs by their boxes.
- **Translation**: `translate.ts` `pairText` splits lines into sentences (`sentences.ts`) and decides each sentence's direction by script (`directionOf`): the person's script → into English (English shown, original behind the tap), Latin → into their language. Same-script natives (German…) are treated as English source for now. `splitText` + `translateLines`: when no sentence goes into English (`englishReady`), `main.ts` `translateInto` shows the English at once (`done` with the translation `translating`/`downloading`) and the card starts reading while the translation comes. `render.ts` writes two halves as plain paragraphs, one per line (no markdown: a picked text is not markdown; `sentences.ts` `unwrapLines` first joins lines broken mid-sentence: a line ending in a letter, digit, comma or hyphen followed by one starting in lower case): `englishHtml` (`span.s[data-i]`) and `translationHtml` (`span.t[data-i]`).
- **Translator** (`engine.ts`, interface `translator.ts`): Firefox Translations (Bergamot, WebAssembly, `vendor/bergamot`, shipped). Models per pair from Mozilla's attachment CDN, pinned with size and SHA-256 in `src/mt-manifest.json`, stored as `<sha256 head>-<name>`. `scripts/build-mt.mjs` picks, per direction, the newest complete version whose filter expression passes for Windows release (en→ru 2.0; the nightly 2.1 invents words). The engine runs in a worker thread (`mt-worker.ts`, loader via `vm.compileFunction`, Firefox's decoder config), ended after 5 idle minutes.
- **App window** (`media/app.html`, `src/webview/app.ts`, `media/app.css`): tabs Words (notebook, search, remove, Export for Anki, Copy), Settings (everything in `settings.ts`; shortcuts recorded from a key press: `webview/keys.ts` `acceleratorOf`, clearable, the two never equal), How to use (steps and a text to try), About (author, links opened through `openLink` and the `LINKS` allowlist, credits; the tray's "About 2Talker…" opens it via `appTab`). Fed by one `ToView {app, AppView}` snapshot, re-sent by `postApp()` on any change; opened from the tray, on the first run, and by a second start without a command. Closing hides it.
- **Voice**: `synth.ts` + `voice-worker.ts` + `kokoro.ts` + `voicestore.ts` (natural voice, files from cc-translator's `voice-1` release), `speech.ts` (System.Speech), unchanged from the panel apart from paths and the `phonemes` message: the voice process's eSpeak gives a word's IPA for the word card (`lookup` → `ipa`), only while the natural voice is downloaded. `NaturalSpeaker` keeps the last 60 made sentences by text, voice and speed and mirrors the process's queue (`requests`): a new reading takes cached audio at once and waits for a sentence still being made for a stopped one instead of asking twice; the card asks for the sentence after each reading ahead (`speakNatural.ahead`), so ⏭ and the next paragraph start at once. `autoplay-policy=no-user-gesture-required` so the card can read before it is touched.

Card (`media/card.html`, `src/webview/card.ts`): the panel's `player.ts`, `hover.ts`, `dom.ts`, `voices.ts`; `preload.ts` exposes `window.tutorHost.post` and forwards `to-view` IPC as window messages. States: reading, translating, downloading, done (English + `TranslationState` of the lower half), empty, no-ocr, failed (`protocol.ts`). English on top (`.body`, read by Listen), translation under it (`.translation`, outside `.body` so the word card skips it); a click on an English word opens the word card (`hover.ts` `showAt`), a click on a sentence marks its pair (`.pair`); the language button hides the lower half; Esc closes. The remote under the English: ⏮ Listen ⏭ and the "One by one" chip (`oneAtATime`): Listen reads from a cursor (the sentence being read, via `PlayerEnv.entered`) to the end, or one sentence and waits; a finished full reading puts the cursor back at the top; Space and ← → work too. With two paragraphs or more, each gets a ▶ in a 26 px left margin (`addParagraphButtons`, shown on hover), reading that paragraph. The word card (`hover.ts`), opened by a click, takes clicks itself: say the word (`player.play` on a detached span), a star that saves it (`saveWord` with the sentence around it) or removes it. `rare.ts` draws a CSS Highlight `rare-word` (dotted underline) under words none of whose `baseForms` are in `media/common-en.txt` (3000 words, OpenSubtitles frequency, CC BY-SA; sent once as `common`); names mid-sentence are skipped; `rareWords` setting. The window follows the body's height (`height` message → `fitCard`), up to `cardHeight` or 70 % of the work area; it is resizable: a drag of an edge (`will-resize` … `resized`, never the card's own growing) saves `cardWidth` and/or `cardHeight`. Opens by the pointer (`placement.ts`), hides on blur unless pinned. Colors: VS Code theme tokens in `media/theme.css` (Light/Dark Modern by `prefers-color-scheme`, which `nativeTheme.themeSource` sets from the `theme` setting: system, light, dark), styles in `media/card.css` (the panel's, trimmed).

Packaging (`electron-builder.yml`): workers and `vendor/` are `asarUnpack`ed; `main.ts` `unpacked()` maps their paths.

## Product rules (owner decisions, 2026-10-26)

- A separate app and repository (`ikstro/2talker`), not part of the VS Code tutor. Named 2Talker (was tu-talk); icon: a white letter A and a sound wave on a black tile (`build/icon.svg`).
- Offline translation, no Claude; quality below the tutor's is accepted; no A1–C2 levels. Engine: Firefox Translations (owner chose it over Opus-MT after a comparison).
- The result is a card by the pointer: the English on top, read aloud at once, the whole translation under it. An English text shows and reads before its translation is in. Closing the card (Esc too) stops the voice.
- A click on an English word shows its dictionary meanings, says it and saves it with a small star (the notebook, exported for Anki); a click on a sentence marks its other side. A dotted line under less common words, on by default.
- Interface in English only (the app is for English learners; no localization). English is the only learned language; the native language is any of the 31.
- Distribution: public GitHub repository and releases, unsigned installer, auto-update. macOS: not now.
- The author is shown: About tab and tray item, "Made by Yevhen Peshynskyi · Design automation engineer" with ikstro.com; the installer's publisher is the same name.
- The card: resizable by its edges, size kept; a remote with "one by one" for listening sentence by sentence; ▶ per paragraph in the margin, never on the words (a click on a word is its meanings). Speeds up to 1.5. Theme: as Windows, light or dark. Shortcuts: Ctrl+C twice (can be turned off), a selection shortcut, the snip shortcut, all changeable.
- Trigger for a selection: Ctrl+C twice; screenshot: Windows' snipping overlay behind a shortcut.
