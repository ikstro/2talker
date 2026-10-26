// 2Talker's settings, kept in settings.json in the app's folder
// (%APPDATA%\2Talker). The learned language is English: the natural voice and
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
  /** Ctrl+C pressed twice asks for a translation. */
  doubleCopy: boolean
  /** A shortcut that copies the selection and translates it; empty for none. Electron's accelerator form. */
  selectKey: string
  /** The shortcut that snips a piece of the screen; empty for none. */
  snipKey: string
  /** Start 2Talker when Windows starts. */
  startWithWindows: boolean
  /** The offer of the natural voice was closed. */
  naturalDismissed: boolean
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
  startWithWindows: true,
  naturalDismissed: false,
}

export function normalize(raw: unknown, native = DEFAULTS.native): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const key = (v: unknown, d: string) => (typeof v === 'string' ? v.trim() : d)
  const within = (v: unknown, range: { min: number; max: number }, d: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(range.max, Math.max(range.min, v))) : d
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
    startWithWindows: flag(r.startWithWindows, DEFAULTS.startWithWindows),
    naturalDismissed: flag(r.naturalDismissed, DEFAULTS.naturalDismissed),
  }
}
