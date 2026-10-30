// Messages between the main process and the card, the small window that
// shows one picked text or one snipped piece of the screen at a time.
import type { DictationEntry } from './dictationlog'
import type { DeviceProfile } from './hardware'
import type { WordTime } from './kokoro'
import type { Gloss } from './lemma'
import type { NaturalState } from './natural'
import type { Settings, TranslationLevel } from './settings'
import type { SpeechPackState, SpeechPart } from './speechpack'
import type { Choice, Feature, FeaturePlan, SpeechPlan } from './speechplan'
import type { SpeechHealth, SpeechResult, SpeechServiceState } from './speechservice'
import type { TranslationEntry } from './translationlog'
import type { TranslatorState } from './translator'
import type { Learned } from './typist'
import type { SavedWord } from './words'

/** The word dictionary for the person's language: here, none for the language, coming, failed, or not downloaded yet. */
export type DictionaryStatus = 'ready' | 'none' | 'downloading' | 'failed' | 'absent'

export type { Choice, DeviceProfile, DictationEntry, Feature, FeaturePlan, Gloss, NaturalState, SavedWord, Settings, SpeechHealth, SpeechPackState, SpeechPart, SpeechPlan, SpeechResult, WordTime }

/**
 * What the card is for, and where the text came from. To listen to it, in
 * English with its translation under it: `selection` (copied or selected in
 * any program), `screenshot` (read from a snipped piece of the screen). To
 * translate it, shown as it is with its translation, From and To, like
 * DeepL: `translate` (selected), `text` (read from the screen).
 */
export type CardKind = 'selection' | 'screenshot' | 'translate' | 'text'

/** The translation under a text shown as it is (a `translate` or `text` card), asked for with `translateText`. */
export type TextResult =
  | { status: 'none' }
  | { status: 'translating' }
  /** The translator for `language` (a code) is downloading, once. */
  | { status: 'downloading'; language: string; progress: number; size: number }
  /**
   * `text`: the translation as plain text (Copy, Paste); `html`: the same,
   * every sentence a `span.t` (render.ts textOutHtml); `sentences`: the
   * text's sentences in order, as translated, for the card to find in its field.
   */
  | { status: 'ready'; text: string; from: string; to: string; html: string; sentences: string[] }
  | { status: 'failed'; message: string }

/** The card's lower half: the translation, or what keeps it. */
export type TranslationState =
  | { status: 'translating' }
  /** The translator for this language pair is downloading, once. */
  | { status: 'downloading'; progress: number; size: number }
  | { status: 'ready'; html: string }
  | { status: 'failed'; message: string }

/**
 * What the card shows. `done`: `html` is the text in English (see render.ts),
 * on top; an English text is done at once, while its translation still comes.
 */
export type CardState =
  | { status: 'reading' }
  | { status: 'translating' }
  | { status: 'downloading'; progress: number; size: number }
  | { status: 'done'; html: string; translation: TranslationState; note?: string }
  /**
   * The translator's text, as it is: `from` is the language it seems to be
   * in and `to` the one it is translated into (codes, out of `languages`,
   * those the translator has); `canPaste`: it was selected in a window the
   * translation can be pasted into, over the selection.
   */
  /** `mine`: the languages the person uses, put first in From and To. */
  | { status: 'text'; text: string; from: string; to: string; languages: string[]; mine?: string[]; result: TextResult; canPaste?: boolean }
  /** The snipped piece of the screen holds no text. */
  | { status: 'empty' }
  /** Windows has no text recognition installed for any language the card could use. */
  | { status: 'no-ocr' }
  | { status: 'failed'; message: string }

export type CardView = {
  /** A new id is a new text: the card scrolls to the top and may read it aloud. */
  id: number
  kind: CardKind
  state: CardState
  /** The learned language (English) and the person's own. */
  target: string
  native: string
  /** The translation level the card translates with (Settings). */
  level: TranslationLevel
  /** Read the English aloud as soon as the card has it. */
  autoRead: boolean
  /**
   * The key that called the card, lit in its header (hotkey.ts notation;
   * "Control+C*2" for Ctrl+C pressed twice); none when it came from the tray.
   */
  via?: string
}

/** When the word card shows: while Shift is held over a word, on any hover, or never. */
export type WordHintMode = 'shift' | 'hover' | 'off'

export type ViewConfig = { voice: string; rate: number; wordHint: WordHintMode; rareWords: boolean; oneAtATime: boolean }

/** The app window's places: Home (always first), its action pages, and Words, Settings, About; 'howto' is the old name of Home. */
export type AppTab = 'home' | 'listen' | 'translate' | 'screen' | 'dictate' | 'transcribe' | 'keyboard' | 'words' | 'transcripts' | 'settings' | 'about' | 'howto'

export type HostVoice = { name: string; lang: string }

/** What the updater is doing; `dev`: a run from source, which never updates. */
export type UpdateStatus =
  | { status: 'dev' | 'idle' | 'checking' | 'none' | 'downloading' }
  | { status: 'ready'; version: string }
  /** Not checked, for a reason that is no fault: the releases are private, or there is no connection. */
  | { status: 'unavailable'; message: string }
  | { status: 'failed'; message: string }

/** A keyboard layout Windows has: `id` as settings.ts keeps it ("04090409"), `name` as Windows calls its language. */
/** One of Windows' layouts: `lang` is its language's code, as the layout fixer's word lists are named. */
export type KeyboardLayout = { id: string; name: string; short: string; lang: string }

/**
 * The speech engine (Dictate, Transcribe, Transcripts): its installed parts,
 * the running service and what it reports. `download` is each choice's size in MB.
 */
export type SpeechView = {
  pack: SpeechPackState
  service: SpeechServiceState
  trouble?: string
  health?: SpeechHealth
  port: number
  /** The Chrome extension's folder, for Load unpacked. */
  extensionDir: string
  /** The extension's version in that folder: Chrome runs an older copy until Reload. */
  extensionShipped: string
  download: { core: number; gpu: number; speakers: number }
  /** What each choice takes on the disk once installed, in MB. */
  installed: { core: number; gpu: number; speakers: number }
  /**
   * Who spoke when: where it runs (the person's choice, else the advice), each way's download and disk in MB,
   * and whether the voices' model itself is on the disk already (then no Hugging Face key is asked).
   */
  speakers: {
    on: 'cuda' | 'cpu'
    sizes: Record<'cuda' | 'cpu', { download: number; installed: number }>
    model: boolean
  }
  /** The model dictation downloads at its first use (0 MB: it is here), on the processor or on the card, and its time for a phrase. */
  firstModel: { cpu: { model: string; mb: number; phrase: number }; cuda: { model: string; mb: number; phrase: number } }
  /** Free space where the engine goes. */
  disk: { freeMb: number; drive: string }
  /** This computer: processor, memory, cards. */
  device: DeviceProfile
  /** Which model runs where and how long each takes here. */
  plan: SpeechPlan
  /** The speed test: offered now (the person has not agreed, and something is still unmeasured), agreed once, models it would measure. */
  test: { offer: boolean; agreed: boolean; runs: number }
  /** The dictation keys are registered (false: another program holds one). */
  keysOk: { dictate: boolean; note: boolean; english: boolean; again: boolean }
}

/** Everything the app window shows, sent whole whenever any of it changes. */
export type AppView = {
  settings: Settings
  version: string
  natural: NaturalState
  hostVoices: HostVoice[]
  /** The languages a person may name as their own: English name and own name. */
  languages: { name: string; native: string }[]
  words: SavedWord[]
  update: UpdateStatus
  /** Each shortcut is registered (false: another program holds it). */
  keysOk: { snip: boolean; select: boolean; translate: boolean; text: boolean; inPlace: boolean; pause: boolean; window: boolean }
  /** What Altype learned from the person's typing (learning.ts): words fixed always, words of theirs. */
  learned: { alwaysFix: Learned[]; myWords: Learned[] }
  /** A program that runs as administrator was in front lately: its keys never reach Altype. */
  elevatedApp?: string
  /** The texts translated lately, newest first (the last 10). */
  translations: TranslationEntry[]
  /** The translator between English and the person's language: here, downloading, or to be downloaded on the first translation. */
  translator: 'absent' | 'downloading' | 'ready' | 'failed' | 'unsupported'
  /** The keyboard layouts Windows has, in its order. */
  layouts: KeyboardLayout[]
  /** Why the keyboard helper does not run, when it should. */
  keyboardTrouble?: string
  /** The program typed in last (its .exe name), to keep words in it as typed. */
  lastApp?: string
  /** Other layout switchers running now (EveryLang, Punto Switcher): they would fix words twice. */
  rivals: string[]
  /** Other programs known to watch the keyboard, running now (AutoHotkey, WhisperTyping…): no harm, named so the person knows. */
  keyboardApps: string[]
  /** Some program pressed keys by itself since the keyboard helper started; Altype ignores those. */
  foreignKeys: boolean
  speech: SpeechView
  /** The phrases dictated lately, newest first (the last 10). */
  dictation: { recent: DictationEntry[] }
  /** The translator for the person's language with its download's progress and size (MB), for the setup's list. */
  translatorState: TranslatorState
  /** Each translation level's models for the person's language (Fast: Firefox's pair), for the Translate page. */
  translation: Record<TranslationLevel, TranslatorState>
  /** Seconds an accurate level takes here, measured once a few translations were done: a sentence, and loading the model after it was let go. */
  translationSpeed: Partial<Record<Exclude<TranslationLevel, 'fast'>, { sentence: number; start?: number }>>
  /** The word dictionary for the person's language. */
  dictionary: { status: DictionaryStatus }
}

/** What the tray's panel shows, sent whole whenever any of it changes. */
export type TrayView = {
  /** The keys of its commands, hotkey.ts notation ("Control+C*2" for Ctrl+C twice); empty when there is none. */
  keys: { listenCopied: string; snipListen: string; snipTranslate: string; switch: string }
  /** The quick settings' switches: fixing as one types, the switch key, the badge, the layout in the tray's icon, Ctrl+C twice, Altype paused. */
  autoFix: boolean
  switchOn: boolean
  layoutBadge: boolean
  trayLayout: boolean
  doubleCopy: boolean
  paused: boolean
  /** The speech engine is installed: a note can be started from here; one is being recorded now. */
  speech: { installed: boolean; recording: boolean; noteKey: string }
  /** The translator between English and the person's language (as `AppView.translator`). */
  translator: AppView['translator']
  native: string
}

/** What the tray's panel can do; each puts the panel away first. */
export type TrayCommand = 'listenCopied' | 'translateCopied' | 'typeToTranslate' | 'listenScreen' | 'translateScreen' | 'note' | 'transcripts' | 'settings' | 'open' | 'quit'

/**
 * Why a word has no meanings: no dictionary exists for the person's language,
 * it is being downloaded, the download failed or is turned off, or the word
 * is not in it.
 */
export type GlossMissing = 'not-english' | 'no-dictionary' | 'downloading' | 'download-failed' | 'download-off' | 'not-found'

export type ToView =
  /** `maximized`: the card fills the screen's work area (and stays, pinned, until closed or restored). */
  | { type: 'card'; card: CardView; config: ViewConfig; pinned: boolean; maximized: boolean }
  /** `platform` is Node's name for the system (win32, darwin, linux), for the steps to add a voice. */
  | { type: 'hostVoices'; voices: HostVoice[]; canSpeak: boolean; platform: string }
  | { type: 'progress'; id: number; pos: number; len: number }
  | { type: 'speakDone'; id: number }
  | { type: 'stop' }
  | { type: 'gloss'; word: string; gloss?: Gloss; missing?: GlossMissing; saved?: boolean }
  /** The word's pronunciation, from the natural voice's phonemizer, once that voice is here. */
  | { type: 'ipa'; word: string; ipa: string }
  /** The word went into the notebook, or left it. */
  | { type: 'saved'; word: string; saved: boolean }
  /** The 3000 most common English words, for the dotted line under the others. */
  | { type: 'common'; words: string[] }
  /** A dictionary finished downloading: words asked while it ran can be asked again. */
  | { type: 'dictReady' }
  /** The app window's whole state. */
  | { type: 'app'; view: AppView }
  /** Show this tab of the app window (the tray's "About Altype…"). */
  | { type: 'appTab'; tab: AppTab }
  /** The app window fills the screen or not (its button, a double click on its bar, Windows' keys): Maximize or Restore. */
  | { type: 'appWindow'; maximized: boolean }
  /** The tray's panel's whole state. */
  | { type: 'tray'; view: TrayView }
  /** Show this transcript in the app window (a finished note's balloon, the extension). */
  | { type: 'openTranscript'; id: string }
  /**
   * The dictation badge: record, then stop (and type it, or keep it as a note), or throw away.
   * `session`: the engine's dictation heard while spoken (engine/stream.py), when the engine has them;
   * `expected`: the languages the person uses (their own, English, the others named); the phrase is one of them.
   */
  | { type: 'dictation'; command: 'start' | 'stop' | 'cancel'; mode: DictationMode; key: string; session?: string; expected?: string[] }
  | { type: 'dictationDone'; text: string }
  | { type: 'dictationError'; message: string }
  /** The tray's panel was just shown: focus its first command. */
  | { type: 'trayShown' }
  | { type: 'natural'; state: NaturalState }
  /** One sentence of reading `id` in the natural voice: 24 kHz audio and when each of its words is spoken. */
  | { type: 'naturalAudio'; id: number; index: number; samples: Float32Array; words: WordTime[] }
  | { type: 'naturalFailed'; id: number; message: string }

/** What a dictated phrase becomes: typed where the cursor is, typed in English, or a note in the knowledge base. */
export type DictationMode = 'type' | 'english' | 'note'

export type ToHost =
  | { type: 'lookup'; word: string }
  | { type: 'ready' }
  | { type: 'speak'; id: number; items: string[]; lang: string; separator: string }
  /** Reads `items` in a natural voice; `naturalAt` says which of them started playing, so the next ones get made. */
  /** `ahead`: sentences to make after `items` and keep, not to read (what a step forward will want). */
  | { type: 'speakNatural'; id: number; items: string[]; voice: string; rate: number; ahead?: string[] }
  | { type: 'naturalAt'; id: number; index: number }
  | { type: 'downloadNatural' }
  /** The person closed the offer of the natural voice. */
  | { type: 'dismissNatural' }
  | { type: 'stop' }
  | { type: 'openSpeechSettings' }
  /** Windows Settings → Language, where text recognition for a language is added. */
  | { type: 'openLanguageSettings' }
  /** The card's content is this tall, in CSS pixels; the window follows. */
  | { type: 'height'; px: number }
  /** A pinned card stays open when another window is clicked. */
  | { type: 'pin'; on: boolean }
  /** The card fills the screen, or goes back to where and how big it was. */
  | { type: 'maximize'; on: boolean }
  | { type: 'close' }
  /** Translate the last text again, after a failure. */
  | { type: 'retry' }
  /** Translate a text card's text (as it stands, maybe edited) from one language into another, by codes. */
  | { type: 'translateText'; id: number; text: string; from: string; to: string }
  | { type: 'copyText'; text: string }
  /** Paste a translation over the selection it was made from, in the window it was selected in. */
  | { type: 'pasteText'; id: number; text: string }
  /** Put a word into the notebook, with the sentence it was met in, or take it out. */
  | { type: 'saveWord'; word: string; sentence: string }
  | { type: 'unsaveWord'; word: string }
  // The app window.
  | { type: 'appReady' }
  | { type: 'saveSettings'; patch: Partial<Settings> }
  | { type: 'removeWord'; id: number }
  /** Save the notebook as a file for Anki, or copy it as text. */
  | { type: 'exportWords' }
  | { type: 'copyWords' }
  | { type: 'checkUpdates' }
  /** Open one of the About tab's links in the browser. */
  | { type: 'openLink'; url: string }
  /** The app window's own buttons: it has no Windows frame. Close hides it, as Altype lives in the tray. */
  | { type: 'window'; action: 'minimize' | 'maximize' | 'close' }
  // The tray's panel.
  | { type: 'trayReady' }
  /** The panel's content is this tall, in CSS pixels; the window follows. */
  | { type: 'trayHeight'; px: number }
  | { type: 'tray'; command: TrayCommand }
  /** Esc, or a click outside it. */
  | { type: 'trayClose' }
  // The speech engine; `models` are downloaded once the service runs (the setup's picks).
  | { type: 'installSpeech'; parts: SpeechPart[]; models?: string[] }
  /** The first-run setup: the translator for the person's language and its word dictionary, downloaded ahead of use. */
  | { type: 'prepareTranslator' }
  /** The translation level picked on the Translate page: saved, and its models downloaded; a level's model deleted (Fast in its place when it was in use). */
  | { type: 'translationLevel'; level: TranslationLevel }
  | { type: 'removeTranslation'; level: Exclude<TranslationLevel, 'fast'> }
  | { type: 'prepareDictionary' }
  /** Run the speed test (the person agreed), or not now. */
  | { type: 'testSpeech' }
  | { type: 'declineSpeechTest' }
  /** A speech model downloaded now, ahead of its use. */
  | { type: 'downloadSpeechModel'; model: string }
  | { type: 'removeSpeech' }
  | { type: 'restartSpeech' }
  | { type: 'showInFolder'; path: string }
  | { type: 'openPath'; path: string }
  /** Forget the phrases dictated lately; the texts translated lately. */
  | { type: 'clearDictation' }
  | { type: 'clearTranslations' }
  /** What Altype learned from the person's typing: one word out of a list, or everything. */
  | { type: 'unlearn'; list: 'alwaysFix' | 'myWords'; word: string }
  | { type: 'forgetLearned' }
  /** The settings saved as a file, read from one (the person picks it), or all back to how they came. */
  | { type: 'exportSettings' }
  | { type: 'importSettings' }
  | { type: 'resetSettings' }
  // The dictation badge.
  | { type: 'dictationReady' }
  /** A phrase to type: the whole recording, as webm (an engine without sessions). */
  | { type: 'dictationAudio'; mode: DictationMode; audio: Uint8Array }
  /** A phrase to type, recognized while it was spoken: its text, the language the engine heard ("" when it does not say) and how sure it is. */
  | { type: 'dictationText'; mode: DictationMode; text: string; language: string; sure: number }
  /** A note was recorded into the engine as this transcript. */
  | { type: 'dictationNote'; id: string }
  /** The badge's content is this tall, in CSS pixels; the window follows, its bottom edge kept. */
  | { type: 'dictationHeight'; px: number }
  | { type: 'dictationCancelled' }
  | { type: 'dictationFailed'; message: string }

/** Calls a page makes and waits for (ipcMain.handle), through `window.tutorHost.call`. */
export type HostCall =
  /** One call to the speech engine's HTTP API. */
  | { call: 'speech'; method: string; route: string; body?: unknown }
  | { call: 'pickFolder'; title: string; current: string }
  /** Save a transcript: a Save dialog, then the engine writes the file. */
  | { call: 'exportTranscript'; id: string; format: string; name: string }
  | { call: 'copy'; text: string }
  /** Open a page of Chrome's own (the extensions, their keys, one extension's card), which a link cannot: answers chrome.ts `ChromeOpened` (typed, opened, missing, refused). */
  | { call: 'openChrome'; url: string }
  /** The programs with a window open now, by .exe name, for the Programs page: answers string[]. */
  | { call: 'runningApps' }

/** What every page has as `window.tutorHost` (preload.ts). */
export type TutorHost = {
  post(message: ToHost): void
  call(request: HostCall): Promise<unknown>
  /** A dropped or picked file's path on disk. */
  pathOf(file: File): string
}
