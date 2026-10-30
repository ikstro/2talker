// Turns a picked text into pairs: every sentence in English, and its other
// side. The direction is read per sentence from its script, so a Russian
// text with an English line in it gets both right: a sentence in the
// person's own script is translated into English (English on top, the
// original under it); a sentence in English is translated into the person's
// language. Lines, list markers and paragraphs are kept. An English text is
// split first and shown at once; its translation follows.

import { hasScript, langCode, scriptFor, scriptOf, type Script } from './languages'
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

// ---------------------------------------------------------------- a text as it is

/** The language a script is written in, where one is. */
const SCRIPT_LANGUAGE: Partial<Record<Script, string>> = { Greek: 'el', Hebrew: 'he', Devanagari: 'hi', Han: 'zh', Japanese: 'ja', Hangul: 'ko', Thai: 'th', Georgian: 'ka', Armenian: 'hy' }

/** Letters only one language of its script has, in the order they are looked for (Kazakh has і and ы too). */
const OWN_LETTERS: readonly [RegExp, string][] = [
  [/[қғүұһәө]/iu, 'kk'],
  [/[їєґі]/iu, 'uk'],
  [/[ђћџљњј]/iu, 'sr'],
  [/[ыэё]/iu, 'ru'],
  [/[پچژگ]/u, 'fa'],
]

/**
 * What tells languages of one script apart: the most common words of each
 * (media/lang-words.json), and all English words (media/layout/en.txt) for a
 * text too short to hold common ones.
 */
export type LanguageWords = { common: Readonly<Record<string, ReadonlySet<string>>>; english: ReadonlySet<string> }

/**
 * The language a text seems to be in, by code: a script only one language
 * is written in; letters only one language has; else the language most of
 * whose common words the text holds (the person's own, then English, win a
 * tie). A short text without them is English when it has an English word,
 * or in the person's language when it is written in its script. `pool`: the
 * languages the person uses (settings.ts myLanguages); when some of them are
 * written in the text's script, the guess stays among those, so a Russian
 * speaker's short Cyrillic line is not taken for Bulgarian. Letters only one
 * language has still win over it. A guess: the card lets it be changed.
 */
export function languageOf(text: string, native: string, words: LanguageWords, pool: readonly string[] = []): string {
  const own = langCode(native)
  const script = scriptOf(text)
  if (!script) return 'en'
  const only = SCRIPT_LANGUAGE[script]
  if (only) return only
  for (const [letters, code] of OWN_LETTERS) if (scriptFor(code) === script && letters.test(text)) return code
  const mine = pool.filter(code => scriptFor(code) === script)
  const among = (code: string) => mine.length === 0 || mine.includes(code)
  const tokens = text.toLowerCase().replace(/[’ʼ]/g, "'").match(/\p{L}+(?:'\p{L}+)*/gu) ?? []
  let best: { code: string; score: number } | undefined
  for (const [code, common] of Object.entries(words.common)) {
    if (scriptFor(code) !== script || !among(code)) continue
    const score = tokens.filter(t => common.has(t)).length
    const wins = !best || score > best.score || (score === best.score && (code === own || (code === 'en' && best.code !== own)))
    if (score > 0 && wins) best = { code, score }
  }
  if (best) return best.code
  if (script === 'Latin' && among('en') && tokens.some(t => words.english.has(t))) return 'en'
  if (scriptFor(native) === script) return own
  if (mine[0]) return mine[0]
  return script === 'Cyrillic' ? 'ru' : script === 'Arabic' ? 'ar' : 'en'
}

/** The language a text is translated into: English from the person's own, the person's own from any other. */
export function targetFor(from: string, native: string): string {
  const own = langCode(native)
  return from === own ? 'en' : own
}

/** One line of a text translated as it is: its list marker, then each sentence and its translation; no pairs is an empty line. */
export type TextLine = { prefix: string; pairs: { src: string; out: string }[] }

/**
 * A text translated from one language into another, by codes, sentence by
 * sentence: through English when neither is English, as Firefox's translator
 * only goes to and from it (`direct`: one that goes between any two). Lines,
 * list markers and empty lines are kept.
 */
export async function translatePairs(text: string, from: string, to: string, translate: Translate, direct = false): Promise<TextLine[]> {
  const lines = unwrapLines(text.replace(/\r\n?/g, '\n').split('\n')).map(lineUnits)
  const all = lines.flatMap(l => l.sentences)
  let done: (string | undefined)[] = all
  if (from !== to && all.length > 0 && direct) {
    done = await translate(all, from, to)
  } else if (from !== to && all.length > 0) {
    const english = from === 'en' ? all : (await translate(all, from, 'en')).map((s, i) => s?.trim() || all[i])
    done = to === 'en' ? english : await translate(english as string[], 'en', to)
  }
  let i = 0
  const next = (src: string) => ({ src, out: done[i++]?.trim() || src })
  return lines.map(line => ({ prefix: line.prefix, pairs: line.sentences.map(next) }))
}

/** A translated text as plain text: every line its marker and its sentences' translations. */
export function plainText(lines: readonly TextLine[]): string {
  return lines.map(line => line.prefix + line.pairs.map(p => p.out).join(' ')).join('\n')
}

export async function translatePlain(text: string, from: string, to: string, translate: Translate, direct = false): Promise<string> {
  return plainText(await translatePairs(text, from, to, translate, direct))
}
