import { describe, expect, test } from 'vitest'

import { EN, LEXICONS, RU, strokes, TABLES, UK } from './layouts.fixture'
import { bestLayout, caseSlip, chooseFix, convertText, coreOf, meantThere, nextLayout, sourceLayout, typeIn, wordsMeant, type KeyTable, type Reading } from './layoutfix'

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

  test('keys that are signs here and letters there: ;t → же, ,s → бы; it. stays', () => {
    expect(fix(';t', 'en', ['en', 'ru'])).toBe('же')
    expect(fix(',s', 'en', ['en', 'ru'])).toBe('бы')
    for (const w of ['it.', 'to`', ',the', "f'"]) expect(fix(w, 'en', ['en', 'ru'])).toBeUndefined()
  })

  test('a word learned to fix always goes into its language, word as typed or not', () => {
    const { typed, others } = readings('vs', 'en', ['en', 'ru'])
    expect(chooseFix(typed, others, LEXICONS, new Set())).toBeUndefined()
    expect(chooseFix(typed, others, LEXICONS, new Set(), new Map([['vs', 'ru']]))?.text).toBe('мы')
  })

  test('not words, but not to touch: names in camel case, digits, mail, links, kept words', () => {
    expect(coreOf('iPhone')).toBe('iphone')
    expect(fix('iPhone', 'en', ['en', 'ru'])).toBeUndefined()
    expect(fix('ghbdtn1', 'en', ['en', 'ru'])).toBeUndefined()
    expect(fix('ghbdtn', 'en', ['en', 'ru'], ['ghbdtn'])).toBeUndefined()
    expect(fix('f', 'en', ['en', 'ru'])).toBeUndefined()
  })
})

describe('short words meant in another layout', () => {
  function meant(text: string, lang: string, there: string): boolean {
    const { typed, others } = readings(text, lang, ['en', 'ru'])
    return meantThere(typed, others.find(o => o.lang === there) as Reading, LEXICONS)
  }

  test('a rare word as typed, a common one there: z → я, vs → мы, lf → да', () => {
    for (const w of ['z', 'd', 'c', 'vs', 'lf', 'ds']) expect(meant(w, 'en', 'ru')).toBe(true)
  })

  test('a common word as typed stays: в, с, it, the', () => {
    for (const w of ['в', 'с', 'я']) expect(meant(w, 'ru', 'en')).toBe(false)
    for (const w of ['it', 'the', 'a', 'i']) expect(meant(w, 'en', 'ru')).toBe(false)
  })

  test('walking back from the last word, while each was meant there', () => {
    const pair = (text: string) => {
      const { typed, others } = readings(text, 'en', ['en', 'ru'])
      return { typed, there: others[0] as Reading }
    }
    expect(wordsMeant(['hello', 'z', 'rfr'].map(pair), LEXICONS)).toBe(2)
    expect(wordsMeant(['ghbdtn', 'vbh'].map(pair), LEXICONS, new Set(), Number.POSITIVE_INFINITY)).toBe(2)
    expect(wordsMeant(['ghbdtn', 'vbh'].map(pair), LEXICONS)).toBe(1)
  })
})

describe('stray capitals', () => {
  const letter = () => true
  test('two at the start, from four letters', () => {
    expect(caseSlip(strokes('HEllo', 'en'), letter)?.kind).toBe('two')
    expect(caseSlip(strokes('IDs', 'en'), letter)).toBeUndefined()
    expect(caseSlip(strokes('Hello', 'en'), letter)).toBeUndefined()
  })

  test('Caps Lock left on, Shift held for the first', () => {
    const typed = strokes('Ghbdtn', 'en').map(s => ({ ...s, caps: true }))
    const slip = caseSlip(typed, letter)
    expect(slip?.kind).toBe('caps')
    expect(typeIn(slip?.strokes ?? [], RU, l => TABLES[l])).toBe('Привет')
  })
})

describe('the fix key', () => {
  function best(text: string, lang: string, cycle?: string[]): string | undefined {
    const { typed, others } = readings(text, lang, cycle)
    return bestLayout(typed, others, LEXICONS)?.layout
  }

  test('takes the layout that makes the best word, not the next one', () => {
    expect(best('ghbdtn', 'en')).toBe('ru')
    expect(best('ghbdsn', 'en')).toBe('uk')
    expect(best('руддщ', 'ru')).toBe('en')
  })

  test('an explicit press converts what typing leaves alone: digits, a capital inside, a short word', () => {
    expect(best('ghbdtn1', 'en', ['en', 'ru'])).toBe('ru')
    expect(best('gHbdtn', 'en', ['en', 'ru'])).toBe('ru')
    expect(best('yf', 'en', ['en', 'ru'])).toBe('ru')
  })

  test('no word in any layout: none, so the key takes the next one', () => {
    expect(best('hello', 'en', ['en', 'ru'])).toBeUndefined()
    expect(best('R3', 'en', ['en', 'ru'])).toBeUndefined()
  })

  test('a layout without a word list is never chosen', () => {
    const { typed, others } = readings('ghbdtn', 'en', ['en', 'ru'])
    expect(bestLayout(typed, others.map(o => ({ ...o, lang: 'xx' })), LEXICONS)).toBeUndefined()
  })
})
