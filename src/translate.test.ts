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

  test('a sentence in the person’s script goes into English however many English words it holds', () => {
    // From a screenshot: the path is not in backticks, and Latin letters are half of them.
    expect(directionOf('Доска, раунд 3 (сборщик opus high, тот же design-lab/2026-10-25-clubs-review/build/build.mjs, новый раздел наверху)', 'Russian')).toBe('en')
    expect(directionOf('Run `npm test` in E:/Cursor/tu-talk first.', 'Russian')).toBe('native')
    // A single stray letter does not make an English sentence Russian.
    expect(directionOf('Press Ctrl+С twice.', 'Russian')).toBe('native')
    // A Latin-script native: no way to tell German from English yet.
    expect(directionOf('Das ist ein Test.', 'German')).toBe('native')
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
  test('two halves: every line a paragraph, escaped sides, sentences numbered across the text', async () => {
    const lines = await pairText('Use <b>.\nСтоп.\n\n- Next', 'Russian', fake)
    expect(englishHtml(lines)).toBe(
      '<p><span class="s" data-i="0" dir="auto">Use &lt;b&gt;.</span></p><p><span class="s" data-i="1" dir="auto">[ru&gt;en] Стоп.</span></p>' +
        '<p>- <span class="s" data-i="2" dir="auto">Next</span></p>',
    )
    expect(translationHtml(lines)).toBe(
      '<p><span class="t" data-i="0" dir="auto">[en&gt;ru] Use &lt;b&gt;.</span></p><p><span class="t" data-i="1" dir="auto">Стоп.</span></p>' +
        '<p>- <span class="t" data-i="2" dir="auto">[en&gt;ru] Next</span></p>',
    )
  })

  test('a chat’s single line breaks are paragraphs; a sentence broken across lines is one', async () => {
    const chat = 'Card size: drag an edge.\nListen to parts: the remote.\nHotkeys:\nCtrl+C twice can be turned off.'
    expect(englishHtml(await pairText(chat, 'Russian', fake)).match(/<p>/g)).toHaveLength(4)
    const pdf = 'The quick brown fox\njumps over the lazy dog.'
    expect(englishHtml(await pairText(pdf, 'Russian', fake))).toBe('<p><span class="s" data-i="0" dir="auto">The quick brown fox jumps over the lazy dog.</span></p>')
  })
})
