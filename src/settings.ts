// Altype's settings, kept in settings.json in the app's folder
// (%APPDATA%\Altype). The learned language is English: the natural voice and
// the word dictionaries are English ones.

import { findLanguage } from './languages'
import type { WordHintMode } from './protocol'

export const TARGET = 'English'

/** The reading speeds offered; 1.5 is the fastest the voices keep clear. */
export const RATES: readonly number[] = [0.75, 0.9, 1, 1.15, 1.3, 1.5]

export type ThemeMode = 'system' | 'light' | 'dark'

export const CARD_WIDTH = { min: 320, max: 1200 }
/** A card's height cap set by hand; 0 is automatic (most of the screen). */
export const CARD_HEIGHT = { min: 160, max: 2400 }

export type Settings = {
  /** The person's own language, by its English name. */
  native: string
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
  /** Keys (hotkey.ts; empty for none): listen to the selection (Altype copies it), or to a piece of the screen; */
  selectKey: string
  snipKey: string
  /** translate the selection, or a piece of the screen. */
  translateKey: string
  textKey: string
  /** The keyboard: a key (hotkey.ts) that switches the layout to the next of `layouts`; empty for none. */
  switchKey: string
  /** The layouts that key goes through, in order, as Windows names them ("04090409"); empty: all of them. */
  layouts: string[]
  /** A word typed in the wrong layout is typed again in the right one, and the layout switched. */
  autoFix: boolean
  /** A key that types again, in the next layout, what was just typed or selected; empty for none. */
  fixKey: string
  /** Programs (their .exe names, lower case) where words are never fixed by themselves. */
  fixApps: string[]
  /** Words, as typed, never fixed by themselves: the ones a fix was taken back from. */
  keepWords: string[]
  /** A badge with the layout by the text cursor whenever the layout changes. */
  layoutBadge: boolean
  /**
   * Dictate's keys (hotkey.ts notation; empty for none): type what is said where the
   * cursor is, type it in English, or keep it as a note in the knowledge base. They
   * work once the speech engine is installed.
   */
  dictateKey: string
  englishKey: string
  noteKey: string
  /** Start Altype when Windows starts. */
  startWithWindows: boolean
  /** The offer of the natural voice was closed. */
  naturalDismissed: boolean
  /** The Home's opening moment (one line through fix, translate, listen) has played once; Replay plays it again. */
  introSeen: boolean
}

export const DEFAULTS: Settings = {
  native: 'Russian',
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
  switchKey: '',
  layouts: [],
  autoFix: false,
  fixKey: '',
  fixApps: [],
  keepWords: [],
  layoutBadge: false,
  dictateKey: 'Control+Alt+D',
  englishKey: '',
  noteKey: 'Control+Alt+N',
  startWithWindows: true,
  naturalDismissed: false,
  introSeen: false,
}

export function normalize(raw: unknown, native = DEFAULTS.native): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const key = (v: unknown, d: string) => (typeof v === 'string' ? v.trim() : d)
  const within = (v: unknown, range: { min: number; max: number }, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(range.max, Math.max(range.min, v))) : d
  const strings = (v: unknown, clean: (s: string) => string = s => s.trim()) =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map(clean).filter(Boolean))] : []
  const known = typeof r.native === 'string' ? findLanguage(r.native) : undefined
  return {
    native: known && known.name !== TARGET ? known.name : native,
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
    switchKey: key(r.switchKey, DEFAULTS.switchKey),
    layouts: strings(r.layouts, s => s.trim().toUpperCase()).filter(s => /^[0-9A-F]{8}$/.test(s)),
    autoFix: flag(r.autoFix, DEFAULTS.autoFix),
    fixKey: key(r.fixKey, DEFAULTS.fixKey),
    fixApps: strings(r.fixApps, s => s.trim().toLowerCase()),
    keepWords: strings(r.keepWords),
    layoutBadge: flag(r.layoutBadge, DEFAULTS.layoutBadge),
    dictateKey: key(r.dictateKey, DEFAULTS.dictateKey),
    englishKey: key(r.englishKey, DEFAULTS.englishKey),
    noteKey: key(r.noteKey, DEFAULTS.noteKey),
    startWithWindows: flag(r.startWithWindows, DEFAULTS.startWithWindows),
    naturalDismissed: flag(r.naturalDismissed, DEFAULTS.naturalDismissed),
    introSeen: flag(r.introSeen, DEFAULTS.introSeen),
  }
}
