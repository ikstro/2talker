import type { Line, Pair } from './translate'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * One half of the card as plain paragraphs (a picked text is not markdown):
 * lines of a paragraph keep their breaks, list markers stay, everything is
 * escaped. Every sentence is a span carrying its number across the text, so
 * a sentence and its other side find each other.
 */
function halfHtml(lines: readonly Line[], sentence: (pair: Pair, i: number) => string): string {
  const paragraphs: string[][] = [[]]
  let i = 0
  for (const line of lines) {
    if (line.pairs.length === 0) {
      paragraphs.push([])
      continue
    }
    paragraphs[paragraphs.length - 1]?.push(escapeHtml(line.prefix) + line.pairs.map(p => sentence(p, i++)).join(' '))
  }
  return paragraphs
    .filter(p => p.length > 0)
    .map(p => `<p>${p.join('<br>')}</p>`)
    .join('')
}

/** The card's upper half: the text in English, every sentence a `span.s` the voice reads. */
export function englishHtml(lines: readonly Line[]): string {
  return halfHtml(lines, (p, i) => `<span class="s" data-i="${i}" dir="auto">${escapeHtml(p.en)}</span>`)
}

/** The lower half: the other side of every sentence, a `span.t`; a sentence without one stays as it is. */
export function translationHtml(lines: readonly Line[]): string {
  return halfHtml(lines, (p, i) => `<span class="t" data-i="${i}" dir="auto">${escapeHtml(p.other ?? p.en)}</span>`)
}
