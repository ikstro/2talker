import { describe, expect, test } from 'vitest'

import { isRare, rareSpans } from './rare'

const common = new Set(['the', 'walk', 'go', 'nice', 'weather', 'today', 'be'])

describe('rare words', () => {
  test('a word is rare when none of its forms is common; short words and names are not', () => {
    expect(isRare('walked', false, common)).toBe(false)
    expect(isRare('Weather', true, common)).toBe(false)
    expect(isRare('drifted', false, common)).toBe(true)
    expect(isRare('Drifted', true, common)).toBe(true)
    expect(isRare('London', false, common)).toBe(false)
    expect(isRare('NASA', true, common)).toBe(false)
    expect(isRare('is', false, common)).toBe(false)
  })

  test('spans of the rare words in a text', () => {
    const text = 'The boat drifted today; Paris is nice.'
    expect(rareSpans(text, common).map(([a, b]) => text.slice(a, b))).toEqual(['boat', 'drifted'])
  })
})
