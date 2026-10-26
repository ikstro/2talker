// Cuts a line of plain text into the sentences the card pairs with their
// translations. A list item or quote line keeps its marker outside and stays
// one unit; any other line is split into sentences.

const PREFIX = /^(\s*(?:(?:[-*+•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|>\s*)+)?(.*)$/s
// A sentence ends at . ! ? … before a space and a capital (any script), a
// digit, an opening quote or bracket, or a letter of a script without case
// (Chinese, Arabic, Hebrew, Thai…); or right after a full-width 。！？.
const SENTENCE_BREAK = /(?<=[.!?…])\s+(?=[\p{Lu}\p{Lo}\p{N}"'«„“(\[*_`])|(?<=[。！？])\s*(?=\S)/u
// Abbreviations whose dot ends no sentence; protected before the split.
const ABBREVIATIONS = /(?<![\p{L}\p{N}])(e\.g|i\.e|etc|vs|cf|approx|Mr|Mrs|Ms|Dr|No|St|т\.е|т\.д|т\.п|др|см|г)\./gu
const DOT = '\u0001'

export function splitSentences(body: string): string[] {
  const protectedBody = body.replace(ABBREVIATIONS, m => m.replace(/\./g, DOT))
  return protectedBody
    .split(SENTENCE_BREAK)
    .map(s => s.replace(new RegExp(DOT, 'g'), '.').trim())
    .filter(Boolean)
}

export function splitPrefix(raw: string): { prefix: string; body: string } {
  const m = PREFIX.exec(raw)
  return { prefix: m?.[1] ?? '', body: m?.[2] ?? raw }
}

/** One line: its list marker or quote arrow, then its sentences (a list item is one). */
export function lineUnits(line: string): { prefix: string; sentences: string[] } {
  const { prefix, body } = splitPrefix(line.trimEnd())
  if (!body.trim()) return { prefix: '', sentences: [] }
  return { prefix, sentences: prefix ? [body.trim()] : splitSentences(body) }
}
