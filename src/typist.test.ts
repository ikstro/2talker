import { describe, expect, test } from 'vitest'

import { charOf } from './layoutfix'
import { LEXICONS, strokes, TABLES } from './layouts.fixture'
import { Typist, type KbdConfig, type KbdOut, type MouseEvent } from './typist'
import type { Press } from './winkbd'

const KBD_DEFAULTS: KbdConfig = {
  keys: {},
  layoutKeys: {},
  autoFix: false,
  fixTwoCaps: true,
  fixCapsLock: true,
  keepCaps: false,
  fixOnPause: false,
  fixSound: false,
  clickFile: '',
  badge: false,
  trayLayout: false,
  cycle: [],
  languages: [],
  apps: {},
  keepWords: [],
  learn: false,
  alwaysFix: [],
  myWords: [],
  tally: {},
  salt: 'test',
  quietFullScreen: true,
  words: {},
}

const VK_BACK = 0x08
const VK_RETURN = 0x0d
const VK_PAUSE = 0x13
const VK_LSHIFT = 0xa0
const VK_LCONTROL = 0xa2
const VK_C = 0x43

/**
 * A text field in a window, typed into through the typist as Windows would:
 * a key the typist keeps never reaches the field; the keys it presses
 * itself do, and those it presses again for the person go through it anew.
 */
class Desk {
  text = ''
  layout = 'en'
  exe = 'notepad.exe'
  /** Caps Lock as Windows has it. */
  caps = false
  /** How many more times Windows names the layout the window had before its last switch (it answers late). */
  late = 0
  private before = 'en'
  sent: KbdOut[] = []
  /** The field typed in is a password; a program fills the screen. */
  password = false
  fullScreen = false
  clicks = 0
  /** Run a fix as soon as it is due, as the thread's loop does; false holds it, for keys typed meanwhile. */
  auto = true
  private due = false
  private asked = false
  private shift = false
  private time = 0
  readonly typist: Typist

  constructor(config: Partial<KbdConfig>) {
    this.typist = new Typist(
      {
        now: () => this.time,
        foreground: () => ({ hwnd: 1n, tid: 1, pid: 1 }),
        layoutOf: () => {
          if (this.late > 0) {
            this.late--
            return this.before
          }
          return this.layout
        },
        layout: id => (TABLES[id] ? { lang: id, table: TABLES[id] } : undefined),
        installed: () => ['en', 'ru', 'uk'],
        exeOf: () => this.exe,
        elevated: () => false,
        ownExe: 'altype.exe',
        switchLayout: (_hwnd, id) => {
          this.layout = id
        },
        press: keys => this.pressed(keys),
        later: () => {
          this.due = true
        },
        askField: () => {
          this.asked = true
        },
        fullScreen: () => this.fullScreen,
        click: () => {
          this.clicks++
        },
        caretOf: () => undefined,
        capsOf: () => this.caps,
        send: m => this.sent.push(m),
        doubleClickMs: 500,
      },
    )
    this.typist.configure({ ...KBD_DEFAULTS, cycle: ['en', 'ru'], ...config }, LEXICONS)
  }

  /** What the thread's loop does once the hook has answered: the answer about the field, then the fix. */
  flush(): void {
    if (this.asked) {
      this.asked = false
      this.typist.fieldIs(this.password)
    }
    if (!this.due) return
    this.due = false
    this.typist.typeFix()
  }

  /** The thread's clock, `ms` later. */
  tick(ms: number): void {
    this.time += ms
    this.typist.tick()
    if (this.auto) this.flush()
  }

  /** One half of a key press by the person. */
  event(vk: number, down: boolean): void {
    this.time += 30
    if (!this.typist.key(vk, 0, down)) this.apply(vk, down)
    if (this.auto) this.flush()
  }

  wait(ms: number): void {
    this.time += ms
  }

  /** The person switches the layout by other means (Win+Space); Windows names the old one `late` more times. */
  switchBySystem(layout: string, late: number): void {
    this.before = this.layout
    this.layout = layout
    this.late = late
  }

  tap(vk: number): void {
    this.event(vk, true)
    this.event(vk, false)
  }

  /** The keys that type `text` in layout `lang`, pressed whatever the window's layout is. */
  keys(text: string, lang = 'en'): void {
    for (const s of strokes(text, lang)) {
      if (s.shift) this.event(VK_LSHIFT, true)
      this.tap(s.vk)
      if (s.shift) this.event(VK_LSHIFT, false)
    }
  }

  mouse(event: MouseEvent, x: number): void {
    this.time += 30
    this.typist.mouse(event, x, 0, this.time)
  }

  private apply(vk: number, down: boolean): void {
    if (vk === VK_LSHIFT) this.shift = down
    if (!down) return
    if (vk === VK_BACK) this.text = this.text.slice(0, -1)
    else if (vk === VK_RETURN) this.text += '\n'
    else if (vk === 0x14) this.caps = !this.caps
    else this.text += charOf(TABLES[this.layout]!, vk, this.shift, this.caps) ?? ''
  }

  private pressed(keys: readonly Press[]): void {
    for (const key of keys) {
      if ('again' in key) {
        if (!this.typist.key(key.again.vk, key.again.scan, !key.again.up)) this.apply(key.again.vk, !key.again.up)
      } else if ('char' in key) this.text += key.char
      else this.apply(key.vk, true)
    }
  }
}

describe('fixing as one types', () => {
  test('a word in the wrong layout is typed again in the right one, and the layout switched', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('ghbdtn vbh ')
    expect(desk.text).toBe('привет мир ')
    expect(desk.layout).toBe('ru')
  })

  test('Backspace right after takes the fix back and keeps the word', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('ghbdtn ')
    desk.tap(VK_BACK)
    expect(desk.text).toBe('ghbdtn ')
    expect(desk.layout).toBe('en')
    expect(desk.sent).toContainEqual({ type: 'keep', word: 'ghbdtn' })
    desk.tap(VK_BACK)
    expect(desk.text).toBe('ghbdtn')
  })

  test('right words, and programs left out, are not touched', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('hello world. ')
    expect(desk.text).toBe('hello world. ')
    const code = new Desk({ autoFix: true, apps: { 'code.exe': { off: ['fix'], layout: '' } } })
    code.exe = 'code.exe'
    code.keys('ghbdtn ')
    expect(code.text).toBe('ghbdtn ')
  })

  test('a sign that ends the word is typed in the new layout too; Enter ends it as well', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('ghbdtn?')
    expect(desk.text).toBe('привет,')
    const enter = new Desk({ autoFix: true })
    enter.keys('ghbdtn')
    enter.tap(VK_RETURN)
    expect(enter.text).toBe('привет\n')
  })

  test('a short word goes with the word fixed after it; a common one stays (в some)', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('z rfr ')
    expect(desk.text).toBe('я как ')
    const ru = new Desk({ autoFix: true })
    ru.layout = 'ru'
    ru.keys('в ыщьу ', 'ru')
    expect(ru.text).toBe('в some ')
  })

  test('two capitals at the start and a word typed with Caps Lock left on are set right', () => {
    const two = new Desk({ autoFix: true })
    two.keys('HEllo IDs GHbdtn ')
    expect(two.text).toBe('Hello IDs Привет ')
    const caps = new Desk({ autoFix: true })
    caps.caps = true
    caps.keys('Ghbdtn ')
    expect(caps.text).toBe('Привет ')
    expect(caps.caps).toBe(false)
    const off = new Desk({ autoFix: true, fixTwoCaps: false })
    off.keys('HEllo ')
    expect(off.text).toBe('HEllo ')
  })

  test('Caps Lock left on: only a word of the lists is set right; sRGB typed with it on stays, and Caps Lock with it', () => {
    const term = new Desk({ autoFix: true })
    term.caps = true
    term.keys('Srgb Ios ')
    expect(term.text).toBe('sRGB iOS ')
    expect(term.caps).toBe(true)
    const word = new Desk({ autoFix: true })
    word.layout = 'ru'
    word.caps = true
    word.keys('Привет ', 'ru')
    expect(word.text).toBe('Привет ')
    expect(word.caps).toBe(false)
  })

  test('Backspace after a stray capital was set right brings the word back as typed, Caps Lock on again', () => {
    const desk = new Desk({ autoFix: true })
    desk.layout = 'ru'
    desk.caps = true
    desk.keys('Привет ', 'ru')
    desk.tap(VK_BACK)
    expect(desk.text).toBe('пРИВЕТ ')
    expect(desk.caps).toBe(true)
  })

  test('a word with a capital inside is fixed only into a word the person taught: ыКПИ → sRGB', () => {
    const taught = new Desk({ autoFix: true, myWords: [{ word: 'srgb', lang: 'en' }] })
    taught.layout = 'ru'
    taught.keys('sRGB ')
    expect(taught.text).toBe('sRGB ')
    const not = new Desk({ autoFix: true })
    not.layout = 'ru'
    not.keys('sRGB ')
    expect(not.text).toBe('ыКПИ ')
  })

  test('the first word after the person switched the layout is left as typed', () => {
    const desk = new Desk({ autoFix: true })
    desk.layout = 'ru'
    desk.keys('привет ', 'ru')
    desk.switchBySystem('en', 0)
    desk.keys('ghbdtn ghbdtn ')
    expect(desk.text).toBe('привет ghbdtn привет ')
  })

  test('nothing is fixed in a password field, nor while a program fills the screen', () => {
    const secret = new Desk({ autoFix: true })
    secret.password = true
    secret.keys('ghbdtn vbh ')
    expect(secret.text).toBe('ghbdtn vbh ')
    const game = new Desk({ autoFix: true, keys: { switch: 'LeftControl' } })
    game.fullScreen = true
    game.keys('ghbdtn ')
    game.tap(VK_LCONTROL)
    expect(game.text).toBe('ghbdtn ')
    expect(game.layout).toBe('en')
  })

  test('on a pause, a word that looks like none of its language is fixed; one that may become a word is not', () => {
    const desk = new Desk({ autoFix: true, fixOnPause: true, fixSound: true })
    desk.keys('ghbdtn')
    desk.tick(1100)
    expect(desk.text).toBe('привет')
    expect(desk.clicks).toBe(1)
    desk.keys(' мир ', 'ru')
    expect(desk.text).toBe('привет мир ')
    const half = new Desk({ autoFix: true, fixOnPause: true })
    half.keys('hel')
    half.tick(1100)
    expect(half.text).toBe('hel')
  })

  test('keys typed while a fix is on its way come after it', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('ghbdtn')
    desk.auto = false
    desk.keys(' d')
    desk.flush()
    expect(desk.text).toBe('привет в')
  })
})

describe('short words, apostrophes and three layouts, typed', () => {
  test("I Don't typed in the Russian layout: Ш Вщтэе → I Don't, with a space, Enter or on a pause", () => {
    const desk = new Desk({ autoFix: true })
    desk.layout = 'ru'
    desk.keys("I Don't ")
    expect(desk.text).toBe("I Don't ")
    expect(desk.layout).toBe('en')
    const enter = new Desk({ autoFix: true })
    enter.layout = 'ru'
    enter.keys("I Don't")
    enter.tap(VK_RETURN)
    expect(enter.text).toBe("I Don't\n")
    const pause = new Desk({ autoFix: true, fixOnPause: true })
    pause.layout = 'ru'
    pause.keys("Don't")
    pause.tick(1100)
    expect(pause.text).toBe("Don't")
  })

  test("contractions and signs after them: Вщтэе! → Don't!, руддщю → hello., руддщб → hello,", () => {
    for (const text of ["Don't! ", "it's ", "I'm ", 'hello. ', 'hello, ', 'hello?']) {
      const desk = new Desk({ autoFix: true })
      desk.layout = 'ru'
      desk.keys(text)
      expect(desk.text, text).toBe(text)
    }
  })

  test("Ukrainian with an apostrophe typed in English: g`znm → п'ять", () => {
    const desk = new Desk({ autoFix: true, cycle: ['en', 'uk'] })
    desk.keys('g`znm ')
    expect(desk.text).toBe("п'ять ")
    expect(desk.layout).toBe('uk')
  })

  test('a letter goes with the word fixed after it when it was meant there: Ф еру → a the; в и еру → в и the', () => {
    const a = new Desk({ autoFix: true })
    a.layout = 'ru'
    a.keys('a the ')
    expect(a.text).toBe('a the ')
    const ru = new Desk({ autoFix: true })
    ru.layout = 'ru'
    ru.keys('в и ', 'ru')
    ru.keys('the ')
    expect(ru.text).toBe('в и the ')
  })

  test("a sign key alone goes along when it is a word there: z , cltkfk → я б сделал; ' wt → є це", () => {
    const ru = new Desk({ autoFix: true })
    ru.keys('z , cltkfk ')
    expect(ru.text).toBe('я б сделал ')
    const uk = new Desk({ autoFix: true, cycle: ['en', 'uk'] })
    uk.keys("' wt ")
    expect(uk.text).toBe('є це ')
  })

  test('a letter alone stays as typed until a word after it is fixed: z, then Enter', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('z')
    desk.tap(VK_RETURN)
    expect(desk.text).toBe('z\n')
  })

  test('the fix key on one letter goes round the layouts: z → я → z; s → ы → і → s', () => {
    const two = new Desk({ keys: { fix: 'Pause' } })
    two.keys('z')
    two.tap(VK_PAUSE)
    expect(two.text).toBe('я')
    two.tap(VK_PAUSE)
    expect(two.text).toBe('z')
    const three = new Desk({ keys: { fix: 'Pause' }, cycle: ['en', 'ru', 'uk'] })
    three.keys('s')
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      three.tap(VK_PAUSE)
      seen.push(three.text)
    }
    expect(seen).toEqual(['ы', 'і', 's'])
  })

  test('a letter erased inside the word: ghbdtm, Backspace, n → привет', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('ghbdtm')
    desk.tap(VK_BACK)
    desk.keys('n ')
    expect(desk.text).toBe('привет ')
  })

  test('mail typed right stays', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('user@mail.ru ')
    expect(desk.text).toBe('user@mail.ru ')
  })

  test('Ukrainian with Caps Lock left on or two capitals: пРИВІТ, ПРивіт → Привіт', () => {
    const caps = new Desk({ autoFix: true, cycle: ['en', 'uk'] })
    caps.layout = 'uk'
    caps.caps = true
    caps.keys('Привіт ', 'uk')
    expect(caps.text).toBe('Привіт ')
    expect(caps.caps).toBe(false)
    const two = new Desk({ autoFix: true, cycle: ['en', 'uk'] })
    two.layout = 'uk'
    two.keys('ПРивіт ', 'uk')
    expect(two.text).toBe('Привіт ')
  })

  test("with three layouts, a word Russian and Ukrainian share goes into the person's own: yf → на", () => {
    const ru = new Desk({ autoFix: true, cycle: ['en', 'ru', 'uk'], languages: ['ru', 'en'] })
    ru.keys('yf ')
    expect([ru.text, ru.layout]).toEqual(['на ', 'ru'])
    const uk = new Desk({ autoFix: true, cycle: ['en', 'ru', 'uk'], languages: ['uk', 'en'] })
    uk.keys('yf ')
    expect([uk.text, uk.layout]).toEqual(['на ', 'uk'])
    const only = new Desk({ autoFix: true, cycle: ['en', 'ru', 'uk'], languages: ['ru', 'en'] })
    only.keys('ghbdsn ')
    expect([only.text, only.layout]).toEqual(['привіт ', 'uk'])
  })

  test('two capitals stay as typed: NB; the fix key takes them', () => {
    const desk = new Desk({ autoFix: true, keys: { fix: 'Pause' }, cycle: ['en', 'ru', 'uk'], languages: ['uk', 'en'] })
    desk.keys('NB ')
    expect(desk.text).toBe('NB ')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('ТИ ')
  })
})

describe('the fix key', () => {
  test('of three words typed wrong, it converts all three, with the space after them', () => {
    const desk = new Desk({ keys: { fix: 'Pause' } })
    desk.keys('ghbdtn vbh lheu ')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('привет мир друг ')
    expect(desk.layout).toBe('ru')
  })

  test('a word right as typed before them stays: hello vbh → hello мир', () => {
    const desk = new Desk({ keys: { fix: 'Pause' } })
    desk.keys('hello vbh')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('hello мир')
  })

  test('it never reaches back over the place the person switched the layout', () => {
    const desk = new Desk({ keys: { fix: 'Pause', switch: 'LeftControl' } })
    desk.keys('ghbdtn ')
    desk.tap(VK_LCONTROL)
    desk.tap(VK_LCONTROL)
    desk.keys('vbh')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('ghbdtn мир')
  })

  test('short words go with the word after them: z rfr → я как, vs ltkftv → мы делаем', () => {
    const one = new Desk({ keys: { fix: 'Pause' } })
    one.keys('z rfr')
    one.tap(VK_PAUSE)
    expect(one.text).toBe('я как')
    const two = new Desk({ keys: { fix: 'Pause' } })
    two.keys('vs ltkftv')
    two.tap(VK_PAUSE)
    expect(two.text).toBe('мы делаем')
  })

  test('with no layouts chosen, the keys go through those in the languages the person uses', () => {
    expect(new Desk({ cycle: [], languages: ['ru', 'en'] }).typist.cycle()).toEqual(['en', 'ru'])
    // One language's layout alone is no cycle: all of Windows' then.
    expect(new Desk({ cycle: [], languages: ['ru'] }).typist.cycle()).toEqual(['en', 'ru', 'uk'])
    expect(new Desk({ cycle: ['uk', 'en'], languages: ['ru', 'en'] }).typist.cycle()).toEqual(['uk', 'en'])
  })

  test('again goes on round the cycle, back to the word as typed', () => {
    const desk = new Desk({ keys: { fix: 'Pause' }, cycle: ['en', 'ru', 'uk'] })
    desk.keys('I said lheu')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('I said друг')
    expect(desk.layout).toBe('ru')
    desk.tap(VK_PAUSE)
    expect(desk.layout).toBe('uk')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('I said lheu')
    expect(desk.layout).toBe('en')
  })

  test('it takes the layout that makes a word, not the next one', () => {
    const desk = new Desk({ keys: { fix: 'Pause' }, cycle: ['en', 'ru', 'uk'] })
    desk.keys('ghbdsn')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('привіт')
    expect(desk.layout).toBe('uk')
  })

  test('no word in any layout: the next layout of the cycle', () => {
    const desk = new Desk({ keys: { fix: 'Pause' } })
    desk.keys('hello')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('руддщ')
    expect(desk.layout).toBe('ru')
  })

  test('a word with digits, or a kept word, is converted all the same when asked', () => {
    const digits = new Desk({ keys: { fix: 'Pause' } })
    digits.keys('ghbdtn1')
    digits.tap(VK_PAUSE)
    expect(digits.text).toBe('привет1')
    const kept = new Desk({ keys: { fix: 'Pause' }, keepWords: ['ghbdtn'] })
    kept.keys('ghbdtn')
    kept.tap(VK_PAUSE)
    expect(kept.text).toBe('привет')
  })

  test('a click starts over; a selection goes to the main process', () => {
    const desk = new Desk({ keys: { fix: 'Pause' } })
    desk.keys('ghbdtn')
    desk.mouse('left-down', 0)
    desk.mouse('left-up', 0)
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('ghbdtn')
    desk.mouse('left-down', 0)
    desk.mouse('left-up', 80)
    desk.tap(VK_PAUSE)
    expect(desk.sent).toContainEqual({ type: 'selection', cycle: ['en', 'ru'] })
  })

  test('words typed, then selected with Shift and an arrow: the selection goes to the main process, nothing is retyped', () => {
    const desk = new Desk({ keys: { fix: 'Pause' } })
    desk.keys('ghbdtn vbh')
    desk.event(VK_LSHIFT, true)
    desk.tap(0x25)
    desk.event(VK_LSHIFT, false)
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('ghbdtn vbh')
    expect(desk.sent).toContainEqual({ type: 'selection', cycle: ['en', 'ru'] })
  })

  test('right after a fix by itself, it takes the fix back', () => {
    const desk = new Desk({ autoFix: true, keys: { fix: 'Pause' } })
    desk.keys('ghbdtn ')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('ghbdtn ')
  })
})

describe('learning from the person\'s typing', () => {
  test('a word fixed by the fix key, typing going on, is reported', () => {
    const desk = new Desk({ learn: true, keys: { fix: 'Pause' } })
    desk.keys('lheu')
    desk.tap(VK_PAUSE)
    desk.keys(' и', 'ru')
    expect(desk.sent).toContainEqual({ type: 'fixedByHand', word: 'lheu', lang: 'ru' })
  })

  test('a word erased and typed again with the same keys in another layout is a fix by hand', () => {
    const desk = new Desk({ learn: true, autoFix: true })
    desk.keys('vs ')
    for (let i = 0; i < 3; i++) desk.tap(VK_BACK)
    desk.switchBySystem('ru', 0)
    desk.keys('мы ', 'ru')
    expect(desk.sent).toContainEqual({ type: 'fixedByHand', word: 'vs', lang: 'ru' })
  })

  test('a word of the person\'s, typed right three times, is learned, and fixed into after', () => {
    const desk = new Desk({ learn: true, autoFix: true })
    desk.keys('altype altype altype x ')
    const tallies = desk.sent.filter(m => m.type === 'tally')
    expect(tallies.map(m => m.type === 'tally' && m.count)).toEqual([1, 2, 3])
    expect(tallies.at(-1)).toMatchObject({ word: { word: 'altype', lang: 'en' } })
    // The first word after the person switched is theirs as typed; the next one is fixed.
    desk.switchBySystem('ru', 0)
    desk.keys('привет фдензу ', 'ru')
    expect(desk.text).toBe('altype altype altype x привет altype ')
  })

  test('nothing is learned in a password field', () => {
    const desk = new Desk({ learn: true, autoFix: true })
    desk.password = true
    desk.keys('altype altype altype x ')
    expect(desk.sent.find(m => m.type === 'tally' && m.word)).toBeUndefined()
  })

  test('a word learned to fix always is fixed even when it is a word as typed', () => {
    const desk = new Desk({ autoFix: true, alwaysFix: [{ word: 'vs', lang: 'ru' }] })
    desk.keys('vs ')
    expect(desk.text).toBe('мы ')
  })
})

describe('the switch key', () => {
  test('a layout\'s own key goes to that layout, again or not', () => {
    const desk = new Desk({ layoutKeys: { en: 'LeftControl', ru: 'RightControl' } })
    desk.tap(0xa3)
    expect(desk.layout).toBe('ru')
    desk.wait(600)
    desk.tap(0xa3)
    expect(desk.layout).toBe('ru')
    desk.tap(VK_LCONTROL)
    expect(desk.layout).toBe('en')
  })

  test('a program with a layout of its own gets it when it comes in front; one left out of switching ignores the key', () => {
    const desk = new Desk({ keys: { switch: 'Pause' }, apps: { 'code.exe': { off: ['switch'], layout: 'en' } } })
    desk.layout = 'ru'
    desk.exe = 'code.exe'
    desk.tick(150)
    expect(desk.layout).toBe('en')
    desk.tap(VK_PAUSE)
    expect(desk.layout).toBe('en')
  })

  test('Ctrl tapped alone switches; Ctrl with a key or the wheel does not', () => {
    const desk = new Desk({ keys: { switch: 'LeftControl' } })
    desk.tap(VK_LCONTROL)
    expect(desk.layout).toBe('ru')
    desk.tap(VK_LCONTROL)
    expect(desk.layout).toBe('en')
    desk.event(VK_LCONTROL, true)
    desk.tap(VK_C)
    desk.event(VK_LCONTROL, false)
    expect(desk.layout).toBe('en')
    desk.event(VK_LCONTROL, true)
    desk.mouse('wheel', 0)
    desk.event(VK_LCONTROL, false)
    expect(desk.layout).toBe('en')
  })

  test('a key alone, as Caps Lock, is kept from the program', () => {
    const desk = new Desk({ keys: { switch: 'CapsLock' } })
    desk.tap(0x14)
    expect(desk.layout).toBe('ru')
  })
})

describe('keys of the main process', () => {
  test('Ctrl tapped twice translates the selection; the first tap\'s layout switch is taken back', () => {
    const desk = new Desk({ keys: { switch: 'LeftControl', select: 'LeftControl*2' } })
    desk.tap(VK_LCONTROL)
    expect(desk.layout).toBe('ru')
    desk.tap(VK_LCONTROL)
    expect(desk.layout).toBe('en')
    expect(desk.sent).toContainEqual({ type: 'hotkey', action: 'select' })
  })

  test('two taps far apart are two switches', () => {
    const desk = new Desk({ keys: { switch: 'LeftControl', select: 'LeftControl*2' } })
    desk.tap(VK_LCONTROL)
    desk.wait(600)
    desk.tap(VK_LCONTROL)
    expect(desk.layout).toBe('en')
    expect(desk.sent.filter(m => m.type === 'hotkey')).toEqual([])
  })

  test('a side button of the mouse, with or without a modifier, is kept from the program', () => {
    const desk = new Desk({ keys: { text: 'MouseForward', snip: 'Control+MouseBack' } })
    expect(desk.typist.mouse('x-down', 0, 0, 0, 2)).toBe(true)
    expect(desk.typist.mouse('x-up', 0, 0, 0, 2)).toBe(true)
    expect(desk.typist.mouse('x-down', 0, 0, 0, 1)).toBe(false)
    desk.event(VK_LCONTROL, true)
    expect(desk.typist.mouse('x-down', 0, 0, 0, 1)).toBe(true)
    desk.event(VK_LCONTROL, false)
    expect(desk.sent.filter(m => m.type === 'hotkey')).toEqual([
      { type: 'hotkey', action: 'text' },
      { type: 'hotkey', action: 'snip' },
    ])
  })
})

test('Shift tapped twice is the translate key', () => {
  const desk = new Desk({ keys: { translate: 'LeftShift*2' } })
  desk.tap(0xa0)
  desk.tap(0xa0)
  expect(desk.sent).toContainEqual({ type: 'hotkey', action: 'translate' })
  // Shift held for a capital is no tap.
  const typing = new Desk({ keys: { translate: 'LeftShift*2' } })
  typing.keys('Hello World')
  expect(typing.sent.filter(m => m.type === 'hotkey')).toEqual([])
})

test('Alt tapped twice is the translate key, with a mask key from another program between the taps', () => {
  const desk = new Desk({ keys: { translate: 'LeftAlt*2' } })
  desk.tap(0xa4)
  // EveryLang, PowerToys or AutoHotkey press 0xE8 or 0xFF as Alt is let go, so no menu opens.
  desk.typist.key(0xe8, 0, true, false, true)
  desk.typist.key(0xe8, 0, false, false, true)
  desk.tap(0xa4)
  expect(desk.sent).toContainEqual({ type: 'hotkey', action: 'translate' })
})

test('another program\'s keys between two taps (a switcher answering a Ctrl tap) do not break the double', () => {
  const desk = new Desk({ keys: { switch: 'LeftControl', translate: 'LeftControl*2' } })
  desk.tap(VK_LCONTROL)
  // EveryLang switching the layout its own way: Alt+Shift pressed and let go by the program.
  for (const [vk, down] of [[0xa4, true], [0xa0, true], [0xa0, false], [0xa4, false]] as const) desk.typist.key(vk, 0, down, false, true)
  desk.tap(VK_LCONTROL)
  expect(desk.sent).toContainEqual({ type: 'hotkey', action: 'translate' })
  expect(desk.layout).toBe('en')
})

describe('the layout and Caps Lock as Windows has them', () => {
  test('R3, Ctrl, нравится: typed right, nothing is touched, even while Windows names the old layout', () => {
    const desk = new Desk({ autoFix: true, keys: { switch: 'LeftControl' } })
    desk.keys('R3 ')
    desk.tap(VK_LCONTROL)
    desk.late = 20
    desk.keys('нравится ', 'ru')
    expect(desk.text).toBe('R3 нравится ')
    expect(desk.layout).toBe('ru')
  })

  test('a switch made elsewhere, named late: the word on screen is right, so it stays', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('R3 ')
    desk.switchBySystem('ru', 8)
    desk.keys('нравится ', 'ru')
    expect(desk.text).toBe('R3 нравится ')
  })

  test('Rkfcc and Pause: Класс with Caps Lock off, as it is on screen with it on', () => {
    const off = new Desk({ keys: { fix: 'Pause' } })
    off.keys('Rkfcc')
    off.tap(VK_PAUSE)
    expect(off.text).toBe('Класс')
    const on = new Desk({ keys: { fix: 'Pause' } })
    on.caps = true
    on.keys('Rkfcc')
    expect(on.text).toBe('rKFCC')
    on.tap(VK_PAUSE)
    expect(on.text).toBe('кЛАСС')
  })

  test('Caps Lock turned off without its key (Windows can do it on Shift) is noticed', () => {
    const desk = new Desk({ keys: { fix: 'Pause' } })
    desk.caps = true
    desk.keys('a')
    desk.caps = false
    desk.wait(1500)
    desk.mouse('left-down', 0)
    desk.mouse('left-up', 0)
    desk.text = ''
    desk.keys('Rkfcc')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('Класс')
  })

  test('the fix key takes the last word only: R3 before it stays', () => {
    const desk = new Desk({ keys: { fix: 'Pause' } })
    desk.keys('R3 yhfdbncz')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('R3 нравится')
  })
})
