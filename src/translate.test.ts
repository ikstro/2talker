import { describe, expect, test } from 'vitest'

import { englishHtml, translationHtml } from './render'
import { directionOf, englishReady, pairText, splitText, translateLines, type Translate } from './translate'

/** A translator that marks what it was asked: "[ru>en] text". */
const fake: Translate = async (sentences, from, to) => sentences.map(s => `[${from}>${to}] ${s}`)

describe('pairText', () => {
  test('each sentence goes the way its script says', async () => {
    const lines = await pairText('Сборка упала. Check the log.', 'Russian', fake)
    expect(lines).toEqual([
      {
        prefix: '',
        pairs: [
          { en: '[ru>en] Сборка упала.', other: 'Сборка упала.' },
          { en: 'Check the log.', other: '[en>ru] Check the log.' },
        ],
      },
    ])
  })

  test('keeps list markers, collapses empty lines into one paragraph break, drops trailing ones', async () => {
    const lines = await pairText('- Open it.\r\n\r\n\r\n2) Run it.\n\n', 'Russian', fake)
    expect(lines.map(l => [l.prefix, l.pairs.length])).toEqual([
      ['- ', 1],
      ['', 0],
      ['2) ', 1],
    ])
  })

  test('a sentence with too few letters, or a missing answer, stays as it is', async () => {
    const none: Translate = async sentences => sentences.map(() => undefined)
    expect(await pairText('42. Run it.', 'Russian', none)).toEqual([{ prefix: '42. ', pairs: [{ en: 'Run it.' }] }])
    expect(directionOf('OK', 'Russian')).toBeUndefined()
    expect(directionOf('Готово', 'Russian')).toBe('en')
    expect(directionOf('Done here', 'Russian')).toBe('native')
  })
})

describe('splitText', () => {
  test('an English text reads in English before anything is translated', async () => {
    const split = splitText('Check the log. OK', 'Russian')
    expect(englishReady(split)).toBe(true)
    const before = englishHtml(split.lines)
    const lines = await translateLines(split, 'Russian', fake)
    expect(englishHtml(lines)).toBe(before)
    expect(lines[0]?.pairs.map(p => p.other)).toEqual(['[en>ru] Check the log.', undefined])
  })

  test('a text in the person’s script waits for its English', () => {
    expect(englishReady(splitText('Сборка упала. Check the log.', 'Russian'))).toBe(false)
  })
})

describe('englishHtml, translationHtml', () => {
  test('two halves: paragraphs, line breaks, escaped sides, sentences numbered across the text', async () => {
    const lines = await pairText('Use <b>.\nСтоп.\n\n- Next', 'Russian', fake)
    expect(englishHtml(lines)).toBe(
      '<p><span class="s" data-i="0" dir="auto">Use &lt;b&gt;.</span><br><span class="s" data-i="1" dir="auto">[ru&gt;en] Стоп.</span></p>' +
        '<p>- <span class="s" data-i="2" dir="auto">Next</span></p>',
    )
    expect(translationHtml(lines)).toBe(
      '<p><span class="t" data-i="0" dir="auto">[en&gt;ru] Use &lt;b&gt;.</span><br><span class="t" data-i="1" dir="auto">Стоп.</span></p>' +
        '<p>- <span class="t" data-i="2" dir="auto">[en&gt;ru] Next</span></p>',
    )
  })
})
