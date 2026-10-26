// Messages between the main process and the card, the small window that
// shows one picked text or one snipped piece of the screen at a time.
import type { WordTime } from './kokoro'
import type { Gloss } from './lemma'
import type { NaturalState } from './natural'
import type { Settings } from './settings'
import type { SavedWord } from './words'

export type { Gloss, NaturalState, SavedWord, Settings, WordTime }

/** Where the text came from: copied twice in any program, or read from a snipped piece of the screen. */
export type CardKind = 'selection' | 'screenshot'

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
  /** Read the English aloud as soon as the card has it. */
  autoRead: boolean
}

/** When the word card shows: while Shift is held over a word, on any hover, or never. */
export type WordHintMode = 'shift' | 'hover' | 'off'

export type ViewConfig = { voice: string; rate: number; wordHint: WordHintMode; rareWords: boolean; oneAtATime: boolean }

/** The app window's tabs. */
export type AppTab = 'words' | 'settings' | 'howto' | 'about'

export type HostVoice = { name: string; lang: string }

/** What the updater is doing; `dev`: a run from source, which never updates. */
export type UpdateStatus =
  | { status: 'dev' | 'idle' | 'checking' | 'none' | 'downloading' }
  | { status: 'ready'; version: string }
  | { status: 'failed'; message: string }

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
  keysOk: { snip: boolean; select: boolean }
}

/**
 * Why a word has no meanings: no dictionary exists for the person's language,
 * it is being downloaded, the download failed or is turned off, or the word
 * is not in it.
 */
export type GlossMissing = 'not-english' | 'no-dictionary' | 'downloading' | 'download-failed' | 'download-off' | 'not-found'

export type ToView =
  | { type: 'card'; card: CardView; config: ViewConfig; pinned: boolean }
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
  /** Show this tab of the app window (the tray's "About 2Talker…"). */
  | { type: 'appTab'; tab: AppTab }
  | { type: 'natural'; state: NaturalState }
  /** One sentence of reading `id` in the natural voice: 24 kHz audio and when each of its words is spoken. */
  | { type: 'naturalAudio'; id: number; index: number; samples: Float32Array; words: WordTime[] }
  | { type: 'naturalFailed'; id: number; message: string }

export type ToHost =
  | { type: 'lookup'; word: string }
  | { type: 'ready' }
  | { type: 'speak'; id: number; items: string[]; lang: string; separator: string }
  /** Reads `items` in a natural voice; `naturalAt` says which of them started playing, so the next ones get made. */
  | { type: 'speakNatural'; id: number; items: string[]; voice: string; rate: number }
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
  | { type: 'close' }
  /** Translate the last text again, after a failure. */
  | { type: 'retry' }
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
