import { describe, expect, test } from 'vitest'

import { lineUnits, splitSentences } from './sentences'

describe('sentences', () => {
  test('splits a line into sentences, keeps a list item whole', () => {
    expect(lineUnits('Open the menu. Pick the disk.')).toEqual({ prefix: '', sentences: ['Open the menu.', 'Pick the disk.'] })
    expect(lineUnits('1. Run it as admin. Then wait.')).toEqual({ prefix: '1. ', sentences: ['Run it as admin. Then wait.'] })
    expect(lineUnits('• Готово.')).toEqual({ prefix: '• ', sentences: ['Готово.'] })
  })

  test('does not split after e.g. or т.е.', () => {
    expect(splitSentences('Use a tool, e.g. Victoria. It works.')).toEqual(['Use a tool, e.g. Victoria.', 'It works.'])
    expect(splitSentences('Возьми диск, т.е. Новый. Потом жди.')).toEqual(['Возьми диск, т.е. Новый.', 'Потом жди.'])
  })

  test('an empty line has no sentences', () => {
    expect(lineUnits('   ')).toEqual({ prefix: '', sentences: [] })
  })
})
