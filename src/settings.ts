// 2Talker's settings, kept in settings.json in the app's folder
// (%APPDATA%\2Talker). The learned language is English: the natural voice and
// the word dictionaries are English ones.

import { findLanguage } from './languages'
import type { WordHintMode } from './protocol'

export const TARGET = 'English'

export type Settings = {
  /** The person's own language, by its English name. */
  native: string
  /** "natural:<id>" for a natural voice, a system voice's name, or empty for Automatic. */
  voice: string
  rate: number
  /** Read the English aloud as soon as a card has it. */
  autoRead: boolean
  wordHint: WordHintMode
  /** A dotted line under the words outside the 3000 most common ones. */
  rareWords: boolean
  /** The shortcut that snips a piece of the screen, in Electron's accelerator form. */
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
  wordHint: 'shift',
  rareWords: true,
  snipKey: 'Control+Alt+S',
  startWithWindows: true,
  naturalDismissed: false,
}

export function normalize(raw: unknown, native = DEFAULTS.native): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  const flag = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  const known = typeof r.native === 'string' ? findLanguage(r.native) : undefined
  return {
    native: known && known.name !== TARGET ? known.name : native,
    voice: typeof r.voice === 'string' ? r.voice : DEFAULTS.voice,
    rate: typeof r.rate === 'number' && r.rate >= 0.5 && r.rate <= 1.5 ? r.rate : DEFAULTS.rate,
    autoRead: flag(r.autoRead, DEFAULTS.autoRead),
    wordHint: r.wordHint === 'hover' || r.wordHint === 'off' ? r.wordHint : 'shift',
    rareWords: flag(r.rareWords, DEFAULTS.rareWords),
    snipKey: typeof r.snipKey === 'string' && r.snipKey.trim() ? r.snipKey.trim() : DEFAULTS.snipKey,
    startWithWindows: flag(r.startWithWindows, DEFAULTS.startWithWindows),
    naturalDismissed: flag(r.naturalDismissed, DEFAULTS.naturalDismissed),
  }
}
