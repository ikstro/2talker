import { describe, expect, test } from 'vitest'

import { charOf } from './layoutfix'
import { LEXICONS, strokes, TABLES } from './layouts.fixture'
import { Typist, type KbdConfig, type KbdOut, type MouseEvent } from './typist'
import type { Press } from './winkbd'

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
  /** Run a fix as soon as it is due, as the thread's loop does; false holds it, for keys typed meanwhile. */
  auto = true
  private due = false
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
        ownExe: 'altype.exe',
        switchLayout: (_hwnd, id) => {
          this.layout = id
        },
        press: keys => this.pressed(keys),
        later: () => {
          this.due = true
        },
        caretOf: () => undefined,
        capsOf: () => this.caps,
        send: m => this.sent.push(m),
        doubleClickMs: 500,
      },
    )
    this.typist.configure({ keys: {}, autoFix: false, badge: false, cycle: ['en', 'ru'], fixApps: [], keepWords: [], words: {}, ...config }, LEXICONS)
  }

  flush(): void {
    if (!this.due) return
    this.due = false
    this.typist.typeFix()
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
    const code = new Desk({ autoFix: true, fixApps: ['code.exe'] })
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

  test('keys typed while a fix is on its way come after it', () => {
    const desk = new Desk({ autoFix: true })
    desk.keys('ghbdtn')
    desk.auto = false
    desk.keys(' d')
    desk.flush()
    expect(desk.text).toBe('привет в')
  })
})

describe('the fix key', () => {
  test('of three words typed wrong, it converts the last only, with the space after it', () => {
    const desk = new Desk({ keys: { fix: 'Pause' } })
    desk.keys('ghbdtn vbh lheu ')
    desk.tap(VK_PAUSE)
    expect(desk.text).toBe('ghbdtn vbh друг ')
    expect(desk.layout).toBe('ru')
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

describe('the switch key', () => {
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
