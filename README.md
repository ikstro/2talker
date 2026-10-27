# Altype

*Your language. Your shortcut.* (Formerly 2Talker.)

Select any text, press **Ctrl+C twice**, and hear it in English. A small Windows app for people learning English: it translates what you picked, reads the English aloud, and shows the translation under it; or, with another key, just translates it, like DeepL. Everything runs on your computer: nothing you read leaves it.

![A card with an English text on top, its translation under it, and a word's meanings](docs/card.png)

- **Any text.** Select it in any program and press **Ctrl+C twice**. A card opens by the pointer: the English on top, read aloud at once, your language under it. An English text shows up before its translation is in; a text in your language is translated into English first.
- **A piece of the screen.** Press **Ctrl+Alt+S** and draw a box over the words: a picture, a video with subtitles, a game. Altype reads the text with the OCR built into Windows.
- **Translate.** A key of your own (Shift twice, say) for the selection, **Ctrl+Alt+T** for a piece of the screen: the text as it is and its translation, from the language it is in into yours, from yours into English. **Paste** (Enter; Shift+Enter is a new line) puts the translation over the selected text; change either language, swap them, copy either side. Your clipboard is left as it was.
- **Keyboard layout** (off at first, in Settings). A key that switches the layout (a tap of Left Ctrl, Caps Lock, any key); a fix key (Pause) that types again, in the right layout, what you just typed in the wrong one, or the selected text; words typed in the wrong layout fixed as you type, for English, Russian and Ukrainian; a badge with the layout by the cursor.
- **Words.** Click an English word for its meanings, how it is said, and a star that keeps it in your word list. A dotted line marks the words outside the 3000 most common ones. Export the list for Anki.
- **Voice.** A natural English voice (Kokoro, 170 MB, offline) or a Windows voice, at the speed you choose, with the spoken word highlighted.

## Install

Download `Altype-Setup-<version>.exe` from the [releases](https://github.com/ikstro/2talker/releases) and run it. The installer is not signed (Altype is a free app), so Windows warns once: **More info → Run anyway**. Altype starts with Windows, lives in the tray and updates itself from the releases. It installs over 2Talker and takes its words and settings along.

The first translation downloads the translator for your language (about 85 MB for Russian ↔ English), once.

## Use

| | |
|---|---|
| **Ctrl+C, Ctrl+C** | listen to the selected text |
| your keys | listen to, or translate, the selection (set them in the settings: a combination, Ctrl or Shift twice, Pause, a mouse side button…) |
| **Ctrl+Alt+S** | listen to a piece of the screen (changeable in the settings) |
| **Ctrl+Alt+T** | translate a piece of the screen |
| your switch key | the next keyboard layout (set it in Settings → Hotkeys) |
| your fix key | what you just typed, or the selection, in the next layout |
| **Backspace** right after a fix | take the fix back; the word is kept as typed |
| **Esc** | close the card and stop the voice |
| **Space** · **←** **→** | play or stop · the previous or next sentence |
| One by one | Listen reads one sentence and waits |
| ▶ in the margin | read one paragraph |
| click a word | its meanings · say it · save it |
| click a sentence | mark its translation |
| drag an edge | make the card wider or taller; it keeps the size |
| **RU** (your language's code) | hide or show the translation |
| pin | keep the card open when another window is clicked |

The tray icon opens the menu: Listen and Translate (the selection, the copied text, a piece of the screen), fixing the layout as you type, read aloud, voice, speed (up to 1.5×), your language, theme (as Windows, light, dark). **Open Altype…** (or a double click) opens the window: Home with every action and its keys (tap one to change them), Words, Settings, About.

From a launcher or a mouse button: `Altype.exe --clipboard` listens to the copied text and `--translate` translates it; `--snip` snips to listen, `--text` to translate.

The keyboard helper looks only at the keys of what you are typing, since your last click; it keeps nothing and sends nothing anywhere. Turn off another layout switcher (EveryLang, Punto Switcher) while it runs, or words get fixed twice.

## Languages

English is the language you learn. Your own language: one of 31 with a Firefox translator in both directions (Russian, Ukrainian, German, French, Spanish, Italian, Portuguese, Polish, Czech, Dutch, Swedish, Norwegian, Danish, Finnish, Greek, Turkish, Romanian, Hungarian, Bulgarian, Serbian, Croatian, Arabic, Hebrew, Persian, Hindi, Chinese, Japanese, Korean, Vietnamese, Thai, Indonesian). Word meanings: English → Russian ships inside; most others download on first use.

The translator is the one Firefox uses offline. It is good with whole sentences and weaker with very short ones out of context.

Text recognition reads the languages whose OCR is installed in Windows: Settings → Time & language → Language & region → the language → Language options → Optical character recognition.

## Build

```
npm install
npm test
npm run typecheck
npm start            # builds and runs from source
npm run dist         # release/Altype-Setup-<version>.exe
npm run icons        # build/icon.svg → build/icon.png, media/icon.png
npm run models       # refreshes src/mt-manifest.json and vendor/bergamot from Mozilla
node scripts/build-words.mjs  # refreshes media/layout/*.txt, the layout fixer's word lists
```

A tag `v<version>` builds the installer in GitHub Actions and publishes the release. See [CLAUDE.md](CLAUDE.md) for how it is put together.

## Author

Yevhen Peshynskyi, design automation engineer — [ikstro.com](https://ikstro.com). MIT License; third-party parts in [NOTICE](NOTICE).
