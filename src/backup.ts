// A backup of what the person made in Krya, one file to keep or to take to
// another computer (Settings › Backup): the settings, the word notebook, the
// mistakes, what Krya learned from their typing (the words, never the
// fingerprints, which are salted on this computer), the recent translations
// and the dictated phrases. Not in it: the downloads (they download again),
// the speech engine's settings with the Hugging Face key (a secret), the
// transcripts (their own folder), this computer's measurements. Importing
// replaces the settings and adds the rest to what is here, so nothing here is
// lost. A settings file exported by 0.10.0–0.10.1 (the settings alone) imports too.

import type { LearnedLists } from './learning'

export const BACKUP_KIND = 'krya-backup'
/** The kind a backup of Altype's days (0.10.2) carries: read as Krya's. */
export const OLD_BACKUP_KINDS: readonly unknown[] = ['altype-backup']

export type BackupParts = {
  words: unknown[]
  mistakes: unknown[]
  learned: Partial<Record<keyof LearnedLists, unknown>>
  translations: unknown[]
  dictation: unknown[]
}

export type Backup = { kind: typeof BACKUP_KIND; version: string; exported: string; settings: unknown } & BackupParts

/** What a file holds: settings to take, and the libraries to add. */
export type BackupRead = { settings: Record<string, unknown> } & BackupParts

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const object = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined)

export function makeBackup(version: string, now: Date, settings: unknown, parts: BackupParts): Backup {
  return { kind: BACKUP_KIND, version, exported: now.toISOString(), settings, ...parts }
}

/** A backup, or a settings file from before backups; throws on anything else. */
export function readBackup(raw: unknown): BackupRead {
  const r = object(raw)
  if (!r) throw new Error('it holds no settings')
  if (r.kind !== BACKUP_KIND && !OLD_BACKUP_KINDS.includes(r.kind)) return { settings: r, words: [], mistakes: [], learned: {}, translations: [], dictation: [] }
  return {
    settings: object(r.settings) ?? {},
    words: list(r.words),
    mistakes: list(r.mistakes),
    learned: object(r.learned) ?? {},
    translations: list(r.translations),
    dictation: list(r.dictation),
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** What a backup holds, in a line: "settings, 120 words, 3 mistakes, 8 learned words, 30 translations, 12 dictated phrases". */
export function backupSummary(b: BackupRead): string {
  const learned = (['fixedOnce', 'alwaysFix', 'myWords'] as const).reduce((n, k) => n + list(b.learned[k]).length, 0)
  return [
    'settings',
    b.words.length ? count(b.words.length, 'word') : '',
    b.mistakes.length ? count(b.mistakes.length, 'mistake') : '',
    learned ? count(learned, 'learned word') : '',
    b.translations.length ? count(b.translations.length, 'translation') : '',
    b.dictation.length ? count(b.dictation.length, 'dictated phrase') : '',
  ]
    .filter(Boolean)
    .join(', ')
}
