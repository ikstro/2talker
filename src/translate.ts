// Turns a picked text into pairs: every sentence in English, and its other
// side. The direction is read per sentence from its script, so a Russian
// text with an English line in it gets both right: a sentence in the
// person's own script is translated into English (English on top, the
// original under it); a sentence in English is translated into the person's
// language. Lines, list markers and paragraphs are kept. An English text is
// split first and shown at once; its translation follows.

import { hasScript, langCode, scriptFor, scriptOf } from './languages'
import { lineUnits, unwrapLines } from './sentences'

/** One sentence: the English side, on top, and the other side, under it. */
export type Pair = { en: string; other?: string }
/** One line of the text: its list marker or quote arrow, then its sentences; no pairs is an empty line. */
export type Line = { prefix: string; pairs: Pair[] }

/** Translates sentences from one language code into another; a missing answer leaves its sentence as it is. */
export type Translate = (sentences: string[], from: string, to: string) => Promise<(string | undefined)[]>

type Unit = { line: number; index: number; text: string; into: 'en' | 'native' | undefined }

/**
 * Which way a sentence goes, from its script; undefined for a sentence with
 * too few letters to tell. Letters of the person's own script, when it is
 * not Latin, settle it: an English sentence has none, while a Russian one
 * often carries English words, paths and names (half its letters, in a
 * screenshot where code is not marked).
 */
export function directionOf(sentence: string, native: string): 'en' | 'native' | undefined {
  const own = scriptFor(native)
  if (!own) return undefined
  if (own !== 'Latin' && hasScript(sentence, own)) return 'en'
  return scriptOf(sentence) === 'Latin' ? 'native' : undefined
}

/** A text cut into lines and sentences, nothing translated yet: every sentence as it was written. */
export type Split = { lines: Line[]; units: Unit[] }

export function splitText(text: string, native: string): Split {
  const lines: Line[] = []
  const units: Unit[] = []
  for (const raw of unwrapLines(text.replace(/\r\n?/g, '\n').split('\n'))) {
    const { prefix, sentences } = lineUnits(raw)
    // Several empty lines in a row are one paragraph break.
    if (sentences.length === 0 && (lines.length === 0 || lines[lines.length - 1]?.pairs.length === 0)) continue
    const line = lines.push({ prefix, pairs: sentences.map(en => ({ en })) }) - 1
    sentences.forEach((s, index) => units.push({ line, index, text: s, into: directionOf(s, native) }))
  }
  while (lines.length > 0 && lines[lines.length - 1]?.pairs.length === 0) lines.pop()
  return { lines, units }
}

/** Whether a split text already reads in English: no sentence of it is translated into English. */
export function englishReady(split: Split): boolean {
  return split.units.every(u => u.into !== 'en')
}

/** Translates a split text's sentences, each its own way, into its lines (which it returns). */
export async function translateLines({ lines, units }: Split, native: string, translate: Translate): Promise<Line[]> {
  const code = langCode(native)
  for (const into of ['en', 'native'] as const) {
    const group = units.filter(u => u.into === into)
    if (group.length === 0) continue
    const done = into === 'en' ? await translate(group.map(u => u.text), code, 'en') : await translate(group.map(u => u.text), 'en', code)
    group.forEach((u, i) => {
      const translation = done[i]?.trim()
      const pair = lines[u.line]?.pairs[u.index]
      if (!pair || !translation) return
      if (into === 'en') {
        pair.en = translation
        pair.other = u.text
      } else {
        pair.other = translation
      }
    })
  }
  return lines
}

export async function pairText(text: string, native: string, translate: Translate): Promise<Line[]> {
  return translateLines(splitText(text, native), native, translate)
}
