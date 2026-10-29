// The texts translated lately (the Translate card and Translate in place),
// so the Translate page can show a few to copy. Kept in translations.json in
// the app's folder, newest first, and kept small by itself as the dictated
// phrases are (dictationlog.ts): 200 at most and none older than 30 days.

import * as fs from 'node:fs'
import * as path from 'node:path'

import { LOG_DAYS, LOG_MOST } from './dictationlog'

export type TranslationEntry = {
  /** ISO date and time. */
  at: string
  from: string
  to: string
  text: string
  translation: string
}

const DAY_MS = 24 * 60 * 60 * 1000

export class TranslationLog {
  private entries: TranslationEntry[] = []

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown
      if (Array.isArray(raw)) this.entries = raw.filter(isEntry)
    } catch {
      this.entries = []
    }
    this.entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    if (this.prune()) this.save()
  }

  /** Newest first; `limit` of them. */
  list(limit?: number): TranslationEntry[] {
    return this.entries.slice(0, limit ?? this.entries.length)
  }

  /** A translation kept; the same text translated the same way again only moves up. */
  add(entry: Omit<TranslationEntry, 'at'>): void {
    const text = entry.text.trim()
    const translation = entry.translation.trim()
    if (!text || !translation) return
    this.entries = this.entries.filter(e => !(e.text === text && e.from === entry.from && e.to === entry.to))
    this.entries.unshift({ at: new Date(this.now()).toISOString(), from: entry.from, to: entry.to, text, translation })
    this.prune()
    this.save()
  }

  clear(): void {
    if (this.entries.length === 0) return
    this.entries = []
    this.save()
  }

  /** Drops what is past the cap or the age; true when something went. */
  prune(): boolean {
    const n = this.entries.length
    const oldest = this.now() - LOG_DAYS * DAY_MS
    this.entries = this.entries.filter(e => Date.parse(e.at) >= oldest).slice(0, LOG_MOST)
    return this.entries.length !== n
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.entries, null, 2) + '\n', 'utf8')
    } catch (error) {
      console.warn('Altype: could not save the translations', error)
    }
  }
}

function isEntry(e: unknown): e is TranslationEntry {
  const r = e as Partial<TranslationEntry> | null
  return (
    !!r &&
    typeof r.at === 'string' &&
    Number.isFinite(Date.parse(r.at)) &&
    typeof r.from === 'string' &&
    typeof r.to === 'string' &&
    typeof r.text === 'string' &&
    typeof r.translation === 'string'
  )
}
