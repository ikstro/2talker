import { describe, expect, test } from 'vitest'

import { lineUnits, splitSentences, unwrapLines } from './sentences'

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

  test('a line broken in the middle of a sentence is joined back; any other line break is a new paragraph', () => {
    expect(unwrapLines(['The quick brown fox', 'jumps over the lazy dog.'])).toEqual(['The quick brown fox jumps over the lazy dog.'])
    expect(unwrapLines(['It is a well-', 'known fact, and', 'it holds.'])).toEqual(['It is a wellknown fact, and it holds.'])
    expect(unwrapLines(['Горячие клавиши:', 'Ctrl+C дважды можно выключить.', 'клавишу скриншота можно поменять.'])).toEqual([
      'Горячие клавиши:',
      'Ctrl+C дважды можно выключить.',
      'клавишу скриншота можно поменять.',
    ])
    expect(unwrapLines(['Size: drag an edge', 'Listen to parts'])).toEqual(['Size: drag an edge', 'Listen to parts'])
    expect(unwrapLines(['- first item', 'continues here', '', 'next paragraph', 'goes on'])).toEqual(['- first item continues here', '', 'next paragraph goes on'])
  })

  test('a list item broken mid-sentence goes on; the next item, or a line in capitals, stays apart', () => {
    expect(unwrapLines(['- Кнопка в образце реальна (возврат – тумблер в новом', 'сборка). Чтобы проверить, нажмите.', '- Настоящая рассылка'])).toEqual([
      '- Кнопка в образце реальна (возврат – тумблер в новом сборка). Чтобы проверить, нажмите.',
      '- Настоящая рассылка',
    ])
    expect(unwrapLines(['- one item', '- another item'])).toEqual(['- one item', '- another item'])
    expect(unwrapLines(['- one item', 'A new line'])).toEqual(['- one item', 'A new line'])
    expect(unwrapLines(['> a quote broken', 'in two'])).toEqual(['> a quote broken in two'])
  })

  test('an empty line has no sentences', () => {
    expect(lineUnits('   ')).toEqual({ prefix: '', sentences: [] })
  })
})
