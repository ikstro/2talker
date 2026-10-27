import { describe, expect, test } from 'vitest'

import { EN, LEXICONS, RU, strokes, TABLES, UK } from './layouts.fixture'
import { chooseFix, convertText, coreOf, nextLayout, sourceLayout, typeIn, wrongTail, type KeyTable, type Reading } from './layoutfix'

/** How the keys typed as `text` in `lang` read in each layout of `cycle`. */
function readings(text: string, lang: string, cycle = ['en', 'ru', 'uk']): { typed: Reading; others: Reading[] } {
  const s = strokes(text, lang)
  const read = (code: string): Reading => ({ layout: code, lang: code, text: typeIn(s, TABLES[code] as KeyTable, l => TABLES[l]) })
  return { typed: read(lang), others: cycle.filter(c => c !== lang).map(read) }
}

function fix(text: string, lang: string, cycle?: string[], keep: string[] = []): string | undefined {
  const { typed, others } = readings(text, lang, cycle)
  return chooseFix(typed, others, LEXICONS, new Set(keep))?.text
}

describe('keys in another layout', () => {
  test('the same keys read in each layout', () => {
    expect(readings('ghbdtn', 'en').others.map(r => r.text)).toEqual(['привет', 'привет'])
    expect(typeIn(strokes("s]'", 'en'), RU, l => TABLES[l])).toBe('ыъэ')
    expect(typeIn(strokes("s]'", 'en'), UK, l => TABLES[l])).toBe('іїє')
    expect(typeIn(strokes('Ghbdtn?', 'en'), RU, l => TABLES[l])).toBe('Привет,')
  })

  test('a selected text is converted key by key', () => {
    expect(convertText('Ghbdtn? vbh!', EN, RU)).toBe('Привет, мир!')
    expect(convertText('руддщ цщкдв', RU, EN)).toBe('hello world')
    expect(sourceLayout('ghbdtn', [{ id: 'en', table: EN }, { id: 'ru', table: RU }])).toBe('en')
    expect(sourceLayout('руддщ', [{ id: 'en', table: EN }, { id: 'ru', table: RU }])).toBe('ru')
  })

  test('the next layout goes round', () => {
    expect(nextLayout(['en', 'ru'], 'en')).toBe('ru')
    expect(nextLayout(['en', 'ru'], 'ru')).toBe('en')
    expect(nextLayout(['en', 'ru'], 'uk')).toBe('en')
    expect(nextLayout([], 'en')).toBeUndefined()
  })
})

describe('fixing as one types', () => {
  test('a word typed in the wrong layout is fixed', () => {
    expect(fix('ghbdtn', 'en', ['en', 'ru'])).toBe('привет')
    expect(fix('руддщ', 'ru', ['en', 'ru'])).toBe('hello')
    expect(fix('yf', 'en', ['en', 'ru'])).toBe('на')
    expect(fix('cjj,otybt', 'en', ['en', 'ru'])).toBe('сообщение')
    expect(fix('Ghbdtn?', 'en', ['en', 'ru'])).toBe('Привет,')
    expect(fix('ghbdtnbr', 'en', ['en', 'ru'])).toBe('приветик')
  })

  test('Russian or Ukrainian, by the words', () => {
    expect(fix('lzre.', 'en')).toBe('дякую')
    expect(fix('ghbdsn', 'en')).toBe('привіт')
    expect(fix('pltcm', 'en')).toBe('здесь')
  })

  test('words right as typed are left alone', () => {
    for (const w of ['hello', 'world', 'to', 'ok', 'usb', "don't"]) expect(fix(w, 'en', ['en', 'ru'])).toBeUndefined()
    for (const w of ['привет', 'на', 'мир']) expect(fix(w, 'ru', ['en', 'ru'])).toBeUndefined()
  })

  test('not words, but not to touch: names in camel case, digits, mail, links, kept words', () => {
    expect(coreOf('iPhone')).toBe('iphone')
    expect(fix('iPhone', 'en', ['en', 'ru'])).toBeUndefined()
    expect(fix('ghbdtn1', 'en', ['en', 'ru'])).toBeUndefined()
    expect(fix('ghbdtn', 'en', ['en', 'ru'], ['ghbdtn'])).toBeUndefined()
    expect(fix('f', 'en', ['en', 'ru'])).toBeUndefined()
  })
})

describe('the fix key', () => {
  test('takes the words typed wrong, back to the first right one', () => {
    const typed = ['I', 'said', 'ghbdtn', 'vbh']
    expect(wrongTail(typed.map(w => readings(w, 'en', ['en', 'ru'])), LEXICONS)).toBe(2)
    expect(wrongTail(['ghbdtn', 'vbh'].map(w => readings(w, 'en', ['en', 'ru'])), LEXICONS)).toBe(2)
  })

  test('the last word is always taken, even a right one', () => {
    expect(wrongTail([readings('hello', 'en', ['en', 'ru'])], LEXICONS)).toBe(1)
  })
})
