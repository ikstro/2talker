import { describe, expect, test } from 'vitest'

import { normalize } from './settings'
import { parseEntry, vocabularyFor } from './vocabulary'

describe('words to spell', () => {
  test('a line is the word, then what it is heard as in parentheses', () => {
    expect(parseEntry('Peshynskyi')).toEqual({ word: 'Peshynskyi', heard: [] })
    expect(parseEntry('Altype (альтайп, алтайп, all type)')).toEqual({ word: 'Altype', heard: ['альтайп', 'алтайп', 'all type'] })
    expect(parseEntry('Altype ( , altype,, альтайп ')).toEqual({ word: 'Altype', heard: ['альтайп'] })
    expect(parseEntry('(альтайп)')).toEqual({ word: '', heard: ['альтайп'] })
  })

  test('the engine gets every line with a word', () => {
    expect(vocabularyFor({ vocabulary: ['Peshynskyi', '(nothing)', 'Altype (all type)'] })).toEqual([
      { word: 'Peshynskyi', heard: [] },
      { word: 'Altype', heard: ['all type'] },
    ])
  })

  test('settings keep tidy lines, one per word', () => {
    const lines = normalize({ vocabulary: ['  Altype \n (all   type) ', 'altype (альтайп)', 'x'.repeat(300), 5, ''] }).vocabulary
    expect(lines).toEqual(['Altype (all type)', 'x'.repeat(120)])
    expect(normalize({ vocabulary: Array.from({ length: 300 }, (_, i) => `w${i}`) }).vocabulary).toHaveLength(200)
  })
})
