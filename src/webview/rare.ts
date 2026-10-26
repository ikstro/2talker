// A dotted line under the words outside the most common English ones: a hint
// of what to click. Drawn with the CSS Highlight API over the sentences'
// text, so the text itself is untouched and the reading's highlight,
// the word card and the voice see the same nodes.

import { baseForms } from '../lemma'

const HIGHLIGHT = 'rare-word'
const WORD = /[A-Za-z][A-Za-z'’]*[A-Za-z]/g

type HighlightRegistryLike = { set(name: string, value: unknown): void; delete(name: string): void }

function registry(): HighlightRegistryLike | undefined {
  return (globalThis as unknown as { CSS?: { highlights?: HighlightRegistryLike } }).CSS?.highlights
}

/** Whether a word, as met in a text, is outside the common list; a name (capitalized mid-sentence) never is. */
export function isRare(word: string, atStart: boolean, common: ReadonlySet<string>): boolean {
  if (word.length < 3) return false
  if (!atStart && /^[A-Z]/.test(word)) return false
  if (/[A-Z]/.test(word.slice(1))) return false
  return !baseForms(word).some(form => common.has(form))
}

/** The ranges of the rare words in a text node, `text` being its data. */
export function rareSpans(text: string, common: ReadonlySet<string>): [number, number][] {
  const spans: [number, number][] = []
  for (const m of text.matchAll(WORD)) {
    const atStart = /^\s*$/.test(text.slice(0, m.index))
    if (isRare(m[0], atStart, common)) spans.push([m.index, m.index + m[0].length])
  }
  return spans
}

/** Marks the rare words of every sentence (`span.s`) under `container`, or clears the marks. */
export function markRare(container: Element, common: ReadonlySet<string>, on: boolean): void {
  const reg = registry()
  const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight
  if (!reg || !HighlightCtor) return
  reg.delete(HIGHLIGHT)
  if (!on || common.size === 0) return
  const ranges: Range[] = []
  for (const sentence of container.querySelectorAll('span.s')) {
    const walker = document.createTreeWalker(sentence, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node as Text).data
      for (const [start, end] of rareSpans(text, common)) {
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, end)
        ranges.push(range)
      }
    }
  }
  if (ranges.length > 0) reg.set(HIGHLIGHT, new HighlightCtor(...ranges))
}
