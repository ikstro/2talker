// Krya's settings, kept in settings.json in the app's folder
// (%APPDATA%\Krya). The learned language is English: the natural voice and
// the word dictionaries are English ones.

import { findLanguage, LANGUAGES } from './languages'
import type { WordHintMode } from './protocol'
import type { Prefer } from './speechplan'
import type { AppPart } from './typist'

/** A program by its .exe name (lower case): the parts of the keyboard helper left out there, and the layout it starts in ('' for none). */
export type AppRule = { exe: string; off: AppPart[]; layout: string }

export const APP_PARTS: readonly AppPart[] = ['fix', 'switch', 'badge', 'keys']

export const TARGET = 'English'

/** The reading speeds offered; 1.5 is the fastest the voices keep clear. */
export const RATES: readonly number[] = [0.75, 0.9, 1, 1.15, 1.3, 1.5]

export type ThemeMode = 'system' | 'light' | 'dark'

/** Krya's local language models (llmfiles.ts): Accurate is Gemma 4 E4B, Most accurate Gemma 4 12B; each translates and checks English. */
export type LlmModel = 'accurate' | 'most'
export type TranslationLevel = 'fast' | LlmModel

/** The levels (and the models) as the pages and the card name them. */
export const LEVEL_NAMES: Readonly<Record<TranslationLevel, string>> = { fast: 'Fast', accurate: 'Accurate', most: 'Most accurate' }

export const CARD_WIDTH = { min: 320, max: 1200 }
/** A card's height cap set by hand; 0 is automatic (most of the screen). */
export const CARD_HEIGHT = { min: 160, max: 2400 }

export type Settings = {
  /** The person's own language, by its English name. */
  native: string
  /**
   * Other languages the person uses, by code, beyond their own and English
   * (always in): dictation, the translator's guess and the screen's text are
   * read as one of these.
   */
  languages: string[]
  /** "natural:<id>" for a natural voice, a system voice's name, or empty for Automatic. */
  voice: string
  rate: number
  /** Read the English aloud as soon as a card has it. */
  autoRead: boolean
  /** Listen reads one sentence and waits; the arrows step. */
  oneAtATime: boolean
  wordHint: WordHintMode
  /** A dotted line under the words outside the 3000 most common ones. */
  rareWords: boolean
  /** Light, dark, or as Windows is. */
  theme: ThemeMode
  /** The card's width, and how tall it may grow (0: automatic), as last set by dragging its edge. */
  cardWidth: number
  cardHeight: number
  /** Ctrl+C pressed twice: listen to the copied text. */
  doubleCopy: boolean
  /** Keys (hotkey.ts; empty for none): listen to the selection (Krya copies it), or to a piece of the screen; */
  selectKey: string
  snipKey: string
  /** translate the selection, or a piece of the screen. */
  translateKey: string
  textKey: string
  /** Translate the selection in place: the translation pasted over it, no card. */
  inPlaceKey: string
  /** Check my English: the selection's mistakes in the card, set right, Paste over it (checker.ts). */
  checkKey: string
  /** An empty card to type into, from anywhere: the translator, the checker (the tray's Type to translate…, Check my English…). */
  typeKey: string
  typeCheckKey: string
  /** The keyboard: a key (hotkey.ts) that switches the layout to the next of `layouts`; empty for none. `switchOn` turns it and the layouts' own keys off without forgetting them. */
  switchKey: string
  switchOn: boolean
  /** The layouts that key goes through, in order, as Windows names them ("04090409"); empty: all of them. */
  layouts: string[]
  /** A key of each layout's own (layout id → key), going to it at once. */
  layoutKeys: Record<string, string>
  /** A word typed in the wrong layout is typed again in the right one, and the layout switched. */
  autoFix: boolean
  /** Fixing as one types also sets right two capitals at a word's start ("ПРивет") and a word typed with Caps Lock left on ("пРИВЕТ"). */
  fixTwoCaps: boolean
  fixCapsLock: boolean
  /** Words in capitals are left as typed. */
  keepCaps: boolean
  /** A word is fixed after a second without a key too, not only when it ends. */
  fixOnPause: boolean
  /** A quiet click when a word is fixed by itself. */
  fixSound: boolean
  /** Krya learns from the person's typing (learning.ts): words fixed by hand, words of theirs. */
  learn: boolean
  /** A key that types the words at the end, typed in the wrong layout, again in the right one (again: the next layout), or converts the selection; empty for none. `fixKeyOn` turns it off without forgetting it. */
  fixKey: string
  fixKeyOn: boolean
  /** Programs with parts of the keyboard helper left out, or a layout of their own. */
  apps: AppRule[]
  /** Words, as typed (lower case), never fixed by themselves: the ones a fix was taken back from, or added by hand. */
  keepWords: string[]
  /** A badge with the layout by the text cursor whenever the layout (or Caps Lock) changes. */
  layoutBadge: boolean
  /** The tray icon shows the layout in front, as a keycap ("en"). */
  trayLayout: boolean
  /** Nothing of the keyboard helper while a program fills the screen (a game, a presentation, a video). */
  quietFullScreen: boolean
  /** A key that pauses Krya and resumes it; a key that opens its window. Empty for none. */
  pauseKey: string
  windowKey: string
  /**
   * Dictate's keys (hotkey.ts notation; empty for none): type what is said where the
   * cursor is, type it in English, or keep it as a note in the knowledge base. They
   * work once the speech engine is installed.
   */
  dictateKey: string
  englishKey: string
  noteKey: string
  /** Types the last dictated phrase again where the cursor is (dictationlog.ts); empty for none. */
  againKey: string
  /** Practice: a phrase spoken in English, checked in the card (Check my English) instead of typed. */
  practiceKey: string
  /**
   * Where the dictation badge sits: its bottom centre from the bottom centre of
   * the work area of the screen being typed in, in CSS pixels, as the person
   * last dropped it (0, 0 is 12 px above the taskbar's edge, in the middle).
   */
  dictationBadge: { dx: number; dy: number }
  /**
   * Words dictation and transcripts spell as written, one line each as the
   * person typed it: the word, then what it may be heard as in parentheses
   * ("Krya (кря, края)"); vocabulary.ts reads them.
   */
  vocabulary: string[]
  /**
   * Which translator every card and key uses: Fast (Firefox's models), or the
   * local model (`model`, llmtranslator.ts), downloaded when picked. A card
   * waits for the level picked, never another. Never a model other than `model`.
   */
  translationLevel: TranslationLevel
  /** The one local model, Accurate (Gemma 4 E4B) or Most accurate (Gemma 4 12B): Check my English uses it, and translation when it is not Fast. */
  model: LlmModel
  /** Speech models: the most accurate this computer runs in time, or quicker ones. */
  speechPrefer: Prefer
  /** A speech model the person picked for dictation and for transcripts (models.json names); empty: chosen for this computer. */
  dictationModel: string
  transcriptsModel: string
  /** Where "who spoke when" runs: chosen for this computer (the graphics card when it has room), the card, or the processor. */
  speakersDevice: 'auto' | 'cuda' | 'cpu'
  /** The person agreed to the speed test: it runs again by itself when something changes (a model, a card). */
  speechTestAgreed: boolean
  /** "Not now" to the test: what it would have measured then, and when; it is offered again when that changes, a day later at the soonest. */
  speechTestDeclinedKey: string
  speechTestDeclinedAt: number
  /** Start Krya when Windows starts. */
  startWithWindows: boolean
  /** Updates include the test versions published before a release. */
  betaUpdates: boolean
  /** The offer of the natural voice was closed. */
  naturalDismissed: boolean
  /** The Home's opening moment (one line through fix, translate, listen) has played once; Replay plays it again. */
  introSeen: boolean
  /** Krya paused: all its keys and reactions off (Ctrl+C twice, the keyboard helper, dictation) until turned back on. */
  paused: boolean
  /**
   * The first-run setup (the window's wizard: language, this computer, what to
   * download) was finished or skipped. A settings file from before the wizard
   * counts as done; only a fresh install starts with it false (main.ts).
   */
  setupDone: boolean
}

export const DEFAULTS: Settings = {
  native: 'Russian',
  languages: [],
  voice: '',
  rate: 1,
  autoRead: true,
  oneAtATime: false,
  wordHint: 'shift',
  rareWords: true,
  theme: 'system',
  cardWidth: 440,
  cardHeight: 0,
  doubleCopy: true,
  selectKey: '',
  snipKey: 'Control+Alt+S',
  translateKey: '',
  textKey: 'Control+Alt+T',
  inPlaceKey: '',
  checkKey: '',
  typeKey: '',
  typeCheckKey: '',
  switchKey: '',
  switchOn: true,
  layouts: [],
  layoutKeys: {},
  autoFix: false,
  fixTwoCaps: true,
  fixCapsLock: true,
  keepCaps: false,
  fixOnPause: false,
  fixSound: false,
  learn: true,
  fixKey: '',
  fixKeyOn: true,
  apps: [],
  keepWords: [],
  layoutBadge: false,
  trayLayout: false,
  quietFullScreen: true,
  pauseKey: '',
  windowKey: '',
  dictateKey: 'Control+Alt+D',
  englishKey: '',
  noteKey: 'Control+Alt+N',
  againKey: '',
  practiceKey: '',
  dictationBadge: { dx: 0, dy: 0 },
  vocabulary: [],
  translationLevel: 'fast',
  model: 'accurate',
  speechPrefer: 'accuracy',
  dictationModel: '',
  transcriptsModel: '',
  speakersDevice: 'auto',
  speechTestAgreed: false,
  speechTestDeclinedKey: '',
  speechTestDeclinedAt: 0,
  startWithWindows: true,
  betaUpdates: false,
  naturalDismissed: false,
  introSeen: false,
  paused: false,
  setupDone: true,
}

export const VOCABULARY = { lines: 200, chars: 120 }

/** The vocabulary's lines tidied: one line each, single spaces, short; the same word (before its parentheses) once. */
function vocabularyLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const line = item.replace(/\s+/g, ' ').trim().slice(0, VOCABULARY.chars).trim()
    const word = (line.split('(')[0] ?? '').trim().toLowerCase()
    if (!word || seen.has(word)) continue
    seen.add(word)
    out.push(line)
    if (out.length >= VOCABULARY.lines) break
  }
  return out
}

/** A word as Kept as typed holds it: trimmed and in lower case, as the keyboard thread compares them. */
export const keptForm = (text: string): string => text.trim().toLowerCase()

/** Kept as typed with `text` added (the page's Add and the tray's field); undefined when it is empty or there already. */
export function addKept(list: readonly string[], text: string): string[] | undefined {
  const word = keptForm(text)
  if (!word || list.includes(word)) return undefined
  return [...list, word]
}

/** The languages a text of the person's is read as, by code: their own, English, then the others they named. */
export function myLanguages(s: Pick<Settings, 'native' | 'languages'>): string[] {
  return [...new Set([findLanguage(s.native)?.code ?? '', 'en', ...s.languages].filter(Boolean))]
}

/**
 * The programs' rules, whatever the file held: one per program, known parts
 * only. A file from before (`fixApps`, programs where words were never fixed)
 * becomes rules that leave fixing out.
 */
function appRules(raw: unknown, old: unknown): AppRule[] {
  const items = Array.isArray(raw) ? raw : Array.isArray(old) ? old.map(exe => ({ exe, off: ['fix'], layout: '' })) : []
  const seen = new Set<string>()
  const out: AppRule[] = []
  for (const item of items) {
    const r = (item && typeof item === 'object' ? item : {}) as { exe?: unknown; off?: unknown; layout?: unknown }
    const exe = typeof r.exe === 'string' ? r.exe.trim().toLowerCase() : ''
    if (!exe || seen.has(exe)) continue
    seen.add(exe)
    const off = Array.isArray(r.off) ? APP_PARTS.filter(p => (r.off as unknown[]).includes(p)) : []
    const layout = typeof r.layout === 'string' && /^[0-9A-F]{8}$/i.test(r.layout) ? r.layout.toUpperCase() : ''
    out.push({ exe, off, layout })
  }
  return out
}

/** Each layout's own key, by layout id; empty keys dropped. */
function layoutKeys(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [id, key] of Object.entries(raw as Record<string, unknown>)) {
    if (/^[0-9A-F]{8}$/i.test(id) && typeof key === 'string' && key.trim()) out[id.toUpperCase()] = key.trim()
  }
  return out
}

/** The badge's offset as numbers, whatever the file held; a screen is never wider than this. */
function badgeOffset(v: unknown): Settings['dictationBadge'] {
  const r = (v && typeof v === 'object' ? v : {}) as { dx?: unknown; dy?: unknown }
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(Math.max(-20000, Math.min(20000, x))) : 0)
  return { dx: n(r.dx), dy: n(r.dy) }
}

/**
 * The level and the one model, kept in step: the model wins, so picking one on
 * the Check page moves a translation level that was the other model too. A
 * file from before the shared model (0.10.1) takes the model from its level.
 */
function levelAndModel(level: unknown, model: unknown): Pick<Settings, 'translationLevel' | 'model'> {
  const isModel = (v: unknown): v is LlmModel => v === 'accurate' || v === 'most'
  const m = isModel(model) ? model : isModel(level) ? level : DEFAULTS.model
  return { translationLevel: isModel(level) ? m : 'fast', model: m }
}

export function normalize(raw: unknown, native = DEFAULTS.native): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings | 'fixApps', unknown>>
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const key = (v: unknown, d: string) => (typeof v === 'string' ? v.trim() : d)
  const within = (v: unknown, range: { min: number; max: number }, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(range.max, Math.max(range.min, v))) : d
  const strings = (v: unknown, clean: (s: string) => string = s => s.trim()) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(clean).filter(Boolean))] : []
  const known = typeof r.native === 'string' ? findLanguage(r.native) : undefined
  const own = known && known.name !== TARGET ? known.name : native
  const ownCode = findLanguage(own)?.code
  return {
    native: own,
    // The person's own and English are always in, so they are never listed twice.
    languages: strings(r.languages, s => s.trim().toLowerCase()).filter(c => c !== 'en' && c !== ownCode && LANGUAGES.some(l => l.code === c)),
    voice: typeof r.voice === 'string' ? r.voice : DEFAULTS.voice,
    rate: typeof r.rate === 'number' && r.rate >= 0.5 && r.rate <= 1.5 ? r.rate : DEFAULTS.rate,
    autoRead: flag(r.autoRead, DEFAULTS.autoRead),
    oneAtATime: flag(r.oneAtATime, DEFAULTS.oneAtATime),
    wordHint: r.wordHint === 'hover' || r.wordHint === 'off' ? r.wordHint : 'shift',
    rareWords: flag(r.rareWords, DEFAULTS.rareWords),
    theme: r.theme === 'light' || r.theme === 'dark' ? r.theme : 'system',
    cardWidth: within(r.cardWidth, CARD_WIDTH, DEFAULTS.cardWidth),
    cardHeight: r.cardHeight === 0 ? 0 : within(r.cardHeight, CARD_HEIGHT, DEFAULTS.cardHeight),
    doubleCopy: flag(r.doubleCopy, DEFAULTS.doubleCopy),
    selectKey: key(r.selectKey, DEFAULTS.selectKey),
    snipKey: key(r.snipKey, DEFAULTS.snipKey),
    translateKey: key(r.translateKey, DEFAULTS.translateKey),
    textKey: key(r.textKey, DEFAULTS.textKey),
    inPlaceKey: key(r.inPlaceKey, DEFAULTS.inPlaceKey),
    checkKey: key(r.checkKey, DEFAULTS.checkKey),
    typeKey: key(r.typeKey, DEFAULTS.typeKey),
    typeCheckKey: key(r.typeCheckKey, DEFAULTS.typeCheckKey),
    switchKey: key(r.switchKey, DEFAULTS.switchKey),
    switchOn: flag(r.switchOn, DEFAULTS.switchOn),
    layouts: strings(r.layouts, s => s.trim().toUpperCase()).filter(s => /^[0-9A-F]{8}$/.test(s)),
    layoutKeys: layoutKeys(r.layoutKeys),
    autoFix: flag(r.autoFix, DEFAULTS.autoFix),
    fixTwoCaps: flag(r.fixTwoCaps, DEFAULTS.fixTwoCaps),
    fixCapsLock: flag(r.fixCapsLock, DEFAULTS.fixCapsLock),
    keepCaps: flag(r.keepCaps, DEFAULTS.keepCaps),
    fixOnPause: flag(r.fixOnPause, DEFAULTS.fixOnPause),
    fixSound: flag(r.fixSound, DEFAULTS.fixSound),
    learn: flag(r.learn, DEFAULTS.learn),
    fixKey: key(r.fixKey, DEFAULTS.fixKey),
    fixKeyOn: flag(r.fixKeyOn, DEFAULTS.fixKeyOn),
    apps: appRules(r.apps, r.fixApps),
    // Lower case, as the keyboard thread compares them; the Set in `strings` drops the same word twice.
    keepWords: strings(r.keepWords, keptForm),
    layoutBadge: flag(r.layoutBadge, DEFAULTS.layoutBadge),
    trayLayout: flag(r.trayLayout, DEFAULTS.trayLayout),
    quietFullScreen: flag(r.quietFullScreen, DEFAULTS.quietFullScreen),
    pauseKey: key(r.pauseKey, DEFAULTS.pauseKey),
    windowKey: key(r.windowKey, DEFAULTS.windowKey),
    dictateKey: key(r.dictateKey, DEFAULTS.dictateKey),
    englishKey: key(r.englishKey, DEFAULTS.englishKey),
    noteKey: key(r.noteKey, DEFAULTS.noteKey),
    againKey: key(r.againKey, DEFAULTS.againKey),
    practiceKey: key(r.practiceKey, DEFAULTS.practiceKey),
    dictationBadge: badgeOffset(r.dictationBadge),
    vocabulary: vocabularyLines(r.vocabulary),
    ...levelAndModel(r.translationLevel, r.model),
    speechPrefer: r.speechPrefer === 'speed' ? 'speed' : 'accuracy',
    dictationModel: key(r.dictationModel, DEFAULTS.dictationModel),
    transcriptsModel: key(r.transcriptsModel, DEFAULTS.transcriptsModel),
    speakersDevice: r.speakersDevice === 'cuda' || r.speakersDevice === 'cpu' ? r.speakersDevice : 'auto',
    speechTestAgreed: flag(r.speechTestAgreed, DEFAULTS.speechTestAgreed),
    setupDone: flag(r.setupDone, DEFAULTS.setupDone),
    speechTestDeclinedKey: key(r.speechTestDeclinedKey, DEFAULTS.speechTestDeclinedKey),
    speechTestDeclinedAt: typeof r.speechTestDeclinedAt === 'number' && Number.isFinite(r.speechTestDeclinedAt) ? r.speechTestDeclinedAt : 0,
    startWithWindows: flag(r.startWithWindows, DEFAULTS.startWithWindows),
    betaUpdates: flag(r.betaUpdates, DEFAULTS.betaUpdates),
    naturalDismissed: flag(r.naturalDismissed, DEFAULTS.naturalDismissed),
    introSeen: flag(r.introSeen, DEFAULTS.introSeen),
    paused: flag(r.paused, DEFAULTS.paused),
  }
}
