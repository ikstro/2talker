# Krya

*Talk to the duck.* (Formerly Altype and 2Talker.) Website: [ikstro.com/krya](https://ikstro.com/krya/), where you can try it in the browser.

Select any text, press **Ctrl+C twice**, and hear it in English. A small Windows app for people learning English: it translates what you picked, reads the English aloud, and shows the translation under it; or, with another key, just translates it, like DeepL. Everything runs on your computer: nothing you read leaves it.

![A card with an English text on top, its translation under it, and a word's meanings](docs/card.png)

- **Any text.** Select it in any program and press **Ctrl+C twice**. A card opens by the pointer: the English on top, read aloud at once, your language under it. An English text shows up before its translation is in; a text in your language is translated into English first.
- **A piece of the screen.** Press **Ctrl+Alt+S** and draw a box over the words: a picture, a video with subtitles, a game. Krya reads the text with the OCR built into Windows.
- **Translate.** A key of your own (Shift twice, say) for the selection, **Ctrl+Alt+T** for a piece of the screen: the text as it is and its translation, from the language it is in into yours, from yours into English. **Paste** (Enter; Shift+Enter is a new line) puts the translation over the selected text; change either language, swap them, copy either side. Your clipboard is left as it was.
- **Keyboard layout** (off at first, in Settings). A key that switches the layout (a tap of Left Ctrl, Caps Lock, any key); a fix key (Pause) that types again, in the right layout, what you just typed in the wrong one, or the selected text; words typed in the wrong layout fixed as you type, for English, Russian and Ukrainian; a badge with the layout by the cursor.
- **Words.** Click an English word for its meanings, how it is said, and a star that keeps it in your word list. A dotted line marks the words outside the 3000 most common ones. Export the list for Anki.
- **Voice.** A natural English voice (Kokoro, 170 MB, offline) or a Windows voice, at the speed you choose, with the spoken word highlighted.

## Install

Download `Krya-Setup-<version>.exe` from the [releases](https://github.com/ikstro/krya/releases) and run it. The installer is not signed (Krya is a free app), so Windows warns once: **More info → Run anyway**. Krya starts with Windows and lives in the tray. It installs over Altype and 2Talker and takes their words, settings and downloads along.

**New versions.** Krya does not update itself: download the new installer from the [releases](https://github.com/ikstro/krya/releases) and run it. It installs over the version you have; your settings, words and downloads stay. Settings → Version links there.

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
| your fix key right after a fix | take the fix back; the word is kept as typed. Backspace only erases, so you can set the ending right |
| **Esc** | close the card and stop the voice |
| **Space** · **←** **→** | play or stop · the previous or next sentence |
| One by one | Listen reads one sentence and waits |
| ▶ in the margin | read one paragraph |
| click a word | its meanings · say it · save it |
| click a sentence | mark its translation |
| drag an edge | make the card wider or taller; it keeps the size |
| **RU** (your language's code) | hide or show the translation |
| pin | keep the card open when another window is clicked |

The tray icon opens the menu: Listen and Translate (the selection, the copied text, a piece of the screen), fixing the layout as you type, read aloud, voice, speed (up to 1.5×), your language, theme (as Windows, light, dark). **Open Krya…** (or a double click) opens the window: Home with every action and its keys (tap one to change them), Words, Settings, About.

From a launcher or a mouse button: `Krya.exe --clipboard` listens to the copied text and `--translate` translates it; `--snip` snips to listen, `--text` to translate.

The keyboard helper looks only at the keys of what you are typing, since your last click; it keeps nothing and sends nothing anywhere. Turn off another layout switcher (EveryLang, Punto Switcher) while it runs, or words get fixed twice.

## Report a problem

Press **Report** at the bottom of the tray menu (or open Krya › Report a problem), write what happened, then pick **Email** or **GitHub issue**. Krya saves `Krya report <date>.zip` in `Documents\Krya\Reports`, shows it in File Explorer and opens the message with your text in it: attach the zip and send it. Krya sends nothing by itself.

The zip holds Krya's logs (Krya's own, the speech engine's, the translation model's), the processor, memory, graphics card and versions, and your settings with your own lists only counted. It never holds your texts, words, mistakes, translations, dictated phrases, transcripts or Hugging Face key; your Windows name and the computer's name are replaced. Open it before sending if you like: it is plain text.

## Who spoke when: the Hugging Face key

Telling speakers apart in a transcript uses pyannote's model, which Hugging Face hands out for free once you accept its terms. Krya asks for a key once, on the Who spoke when page, and shows these steps there too:

1. Sign up at [huggingface.co/join](https://huggingface.co/join), free.
2. Open [the model's page](https://huggingface.co/pyannote/speaker-diarization-community-1) and fill in its form: Company or university, anything (your own name will do); Use case: **Meeting note taker**. Then **Agree and access repository**.
3. Open [Access Tokens](https://huggingface.co/settings/tokens) → **Create new token** → type **Read** → copy the `hf_…` key.
4. Paste it into Krya and press **Save**. The model downloads once; after that everything works offline, and the key is no longer needed. Krya keeps it only on your computer and never shows it again.

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
npm run dist         # release/Krya-Setup-<version>.exe
npm run icons        # build/icon.svg → build/icon.png, media/icon.png
npm run models       # refreshes src/mt-manifest.json and vendor/bergamot from Mozilla
node scripts/build-words.mjs  # refreshes media/layout/*.txt, the layout fixer's word lists
```

A tag `v<version>` builds the installer in GitHub Actions and publishes the release. See [CLAUDE.md](CLAUDE.md) for how it is put together.

## Author

Yevhen Peshynskyi, design automation engineer — [ikstro.com](https://ikstro.com). MIT License; third-party parts in [NOTICE](NOTICE).
