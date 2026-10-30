// The mistakes Check my English found, for Library › Mistakes: each checked
// text that had one, as typed and set right, with its note. Kept in
// mistakes.json in the app's folder, newest first, on this computer only; a
// notebook, so nothing goes by age, only past `MISTAKES_MOST`. What repeats is
// counted by the page from the texts themselves (worddiff.ts).

import * as fs from 'node:fs'
import * as path from 'node:path'

export type MistakeEntry = {
  /** ISO date and time. */
  at: string
  text: string
  corrected: string
  /** The main mistake in the person's language, as the checker said it. */
  note: string
}

export const MISTAKES_MOST = 500

export class MistakeStore {
  private entries: MistakeEntry[] = []

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
  }

  /** Newest first. */
  list(): MistakeEntry[] {
    return this.entries.slice()
  }

  /** A checked text kept when it had a mistake; the same text again only moves up, with what the checker said now. */
  add(entry: Omit<MistakeEntry, 'at'>): boolean {
    const text = entry.text.trim()
    const corrected = entry.corrected.trim()
    if (!text || !corrected || text === corrected) return false
    this.entries = this.entries.filter(e => e.text !== text)
    this.entries.unshift({ at: new Date(this.now()).toISOString(), text, corrected, note: entry.note.trim() })
    this.entries = this.entries.slice(0, MISTAKES_MOST)
    this.save()
    return true
  }

  remove(at: string): void {
    const n = this.entries.length
    this.entries = this.entries.filter(e => e.at !== at)
    if (this.entries.length !== n) this.save()
  }

  clear(): void {
    if (this.entries.length === 0) return
    this.entries = []
    this.save()
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(this.entries, null, 2) + '\n', 'utf8')
    } catch (error) {
      console.warn('Altype: could not save the mistakes', error)
    }
  }
}

function isEntry(e: unknown): e is MistakeEntry {
  const r = e as Partial<MistakeEntry> | null
  return !!r && typeof r.at === 'string' && Number.isFinite(Date.parse(r.at)) && typeof r.text === 'string' && typeof r.corrected === 'string' && typeof r.note === 'string'
}
