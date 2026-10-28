import * as fs from 'node:fs'

import { describe, expect, test } from 'vitest'

import { englishHtml, translationHtml } from './render'
import { directionOf, englishReady, languageOf, pairText, splitText, targetFor, translateLines, translatePlain, type LanguageWords, type Translate } from './translate'

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

describe('a text as it is', () => {
  const lists = JSON.parse(fs.readFileSync('media/lang-words.json', 'utf8')) as Record<string, string[]>
  const words: LanguageWords = {
    common: Object.fromEntries(Object.entries(lists).map(([code, list]) => [code, new Set(list)])),
    english: new Set(fs.readFileSync('media/layout/en.txt', 'utf8').split('\n')),
  }

  test('its language is guessed from its letters and its common words', () => {
    const cases: [string, string][] = [
      ['Привет, как дела? Я сегодня работаю дома.', 'ru'],
      ['Привіт, як справи? Я сьогодні працюю вдома.', 'uk'],
      ['Здравей, как си? Днес работя вкъщи и това е добре.', 'bg'],
      ['Сәлеметсіз бе, қалыңыз қалай?', 'kk'],
      ['The weather is nice today and I am going to the park.', 'en'],
      ['Ich habe heute keine Zeit, aber morgen komme ich gern.', 'de'],
      ["Je ne sais pas ce que tu veux dire, mais c'est bien.", 'fr'],
      ['No sé qué quieres decir, pero está bien.', 'es'],
      ['Nie wiem, co chcesz powiedzieć, ale to jest dobre.', 'pl'],
      ['Bugün çok yorgunum ama yarın seninle buluşabilirim.', 'tr'],
      ['من امروز به پارک رفتم', 'fa'],
      ['أنا لا أعرف ماذا تريد', 'ar'],
      ['Καλημέρα, τι κάνεις;', 'el'],
      ['今日はいい天気ですね', 'ja'],
    ]
    for (const [text, code] of cases) expect([text, languageOf(text, 'Russian', words)]).toEqual([text, code])
  })

  test('a short text: English by its words, or the person\'s own language', () => {
    expect(languageOf('hello', 'Russian', words)).toBe('en')
    expect(languageOf('Straße', 'German', words)).toBe('de')
    expect(languageOf('кошка', 'Bulgarian', words)).toBe('bg')
  })

  test('the languages the person uses narrow the guess within their script', () => {
    const text = 'Днес съм вкъщи.'
    expect(languageOf(text, 'Russian', words)).toBe('bg')
    expect(languageOf(text, 'Russian', words, ['ru', 'en'])).toBe('ru')
    expect(languageOf('Ich bin da', 'Russian', words, ['ru', 'en', 'de'])).toBe('de')
    // A short Latin line stays English; a script none of them uses, and letters only one language has, as before.
    expect(languageOf('hello', 'Russian', words, ['ru', 'en'])).toBe('en')
    expect(languageOf('今日はいい天気ですね', 'Russian', words, ['ru', 'en'])).toBe('ja')
    expect(languageOf('Привіт, як справи?', 'Russian', words, ['ru', 'en'])).toBe('uk')
  })

  test('translated into English from the person\'s language, into it from any other', () => {
    expect(targetFor('ru', 'Russian')).toBe('en')
    expect(targetFor('en', 'Russian')).toBe('ru')
    expect(targetFor('de', 'Russian')).toBe('ru')
  })

  test('translated through English when neither side is English', async () => {
    const calls: string[] = []
    const translate: Translate = async (sentences, from, to) => {
      calls.push(`${from}-${to}`)
      return sentences.map(s => `${to}(${s})`)
    }
    expect(await translatePlain('Hallo. Wie geht es?\n\n- Gut', 'de', 'ru', translate)).toBe('ru(en(Hallo.)) ru(en(Wie geht es?))\n\n- ru(en(Gut))')
    expect(calls).toEqual(['de-en', 'en-ru'])
    calls.length = 0
    expect(await translatePlain('Hello.', 'en', 'en', translate)).toBe('Hello.')
    expect(calls).toEqual([])
  })
})
