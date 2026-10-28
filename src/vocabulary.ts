// Words to spell: the person's own names and terms, one line each as typed on
// the Dictate page ("Peshynskyi", "Altype (альтайп, all type)"). The part
// before the parentheses is how the word is written; inside them, what the
// recognizer may write instead. The engine (engine/vocab.py) tells Whisper the
// spellings and puts the heard forms right afterwards.

import type { Settings } from './settings'

export type VocabularyEntry = { word: string; heard: string[] }

/** One line read as a word and what it is heard as; a line without parentheses has no heard forms. */
export function parseEntry(line: string): VocabularyEntry {
  const open = line.indexOf('(')
  if (open < 0) return { word: line.trim(), heard: [] }
  const close = line.indexOf(')', open)
  const inside = line.slice(open + 1, close < 0 ? undefined : close)
  const word = line.slice(0, open).trim()
  const heard = [...new Set(inside.split(',').map(h => h.trim()).filter(h => h && h.toLowerCase() !== word.toLowerCase()))]
  return { word, heard }
}

/** The vocabulary as the engine takes it (`PUT /settings`); lines without a word are left out. */
export function vocabularyFor(s: Pick<Settings, 'vocabulary'>): VocabularyEntry[] {
  return s.vocabulary.map(parseEntry).filter(e => e.word)
}
