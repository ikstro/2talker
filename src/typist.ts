// What the keyboard helper does with each key and click, apart from Windows
// (kbd-worker.ts feeds it from the hooks and lends it Windows through
// `TypistEnv`). It keeps the keys typed since the last click (never what they
// spell, and nothing on disk), and:
//   - the switch key moves the window in front to the next layout;
//   - a word typed in the wrong layout is erased and typed again in the right
//     one when it ends (Backspace at once takes the fix back);
//   - the fix key types the last word again in the layout that makes the best
//     word of it (again: the next layout), or asks the main process to
//     convert the selection;
//   - a change of layout in front is reported, for the badge by the cursor;
//   - the other keys Electron's shortcuts cannot hold (a double tap of Ctrl,
//     a mouse button) are reported to the main process, which acts on them.

import { DOUBLE_MS, modOf, parseHotkey, type HotkeySpec, type Mod } from './hotkey'
import { bestLayout, charOf, chooseFix, coreOf, nextLayout, typeIn, type KeyTable, type Lexicon, type Reading, type Stroke } from './layoutfix'
import type { Press } from './winkbd'

/** What a key does: switch or fix the layout here; listen to (select, snip) or translate (translate, text) the selection or the screen: the main process's. */
export type KeyAction = 'switch' | 'fix' | 'select' | 'snip' | 'translate' | 'text' | 'dictate' | 'english' | 'note'

export type KbdConfig = {
  /** The key of each action this thread watches for (hotkey.ts); an action left out has none here. */
  keys: Partial<Record<KeyAction, string>>
  autoFix: boolean
  badge: boolean
  /** The layouts the keys go through, in order (ids); all of Windows' when empty. */
  cycle: string[]
  fixApps: string[]
  keepWords: string[]
  /** The word lists by language code (media/layout/<code>.txt). */
  words: Record<string, string>
}

export type KbdIn = { type: 'config'; config: KbdConfig } | { type: 'switchTo'; layout: string } | { type: 'quit' }

export type KbdOut =
  /** The thread to wake after posting: the first message. */
  | { type: 'thread'; tid: number }
  /** The layout in front changed; the text cursor's place in physical pixels, when the program has a system one. */
  | { type: 'layout'; layout: string; caret?: Caret }
  /** A fix was taken back: the word, as typed, is kept from now on. */
  | { type: 'keep'; word: string }
  /** The fix key with a selection: the main process copies it, converts it into the next layout and pastes it. */
  | { type: 'selection'; cycle: string[] }
  /** The program typed in, by its .exe name, when it changes. */
  | { type: 'app'; exe: string }
  /** A key of the main process's was pressed. */
  | { type: 'hotkey'; action: Exclude<KeyAction, 'switch' | 'fix'> }
  /** Another program pressed keys by itself, for the first time since the thread started. */
  | { type: 'foreignKeys' }
  | { type: 'error'; message: string }

export type Caret = { x: number; y: number; h: number }
export type Front = { hwnd: bigint; tid: number; pid: number }

/** What the typist needs of Windows. */
export type TypistEnv = {
  now(): number
  foreground(): Front
  /** The layout a thread types in, by id. */
  layoutOf(tid: number): string
  /** A layout Windows has: its language code and what its keys type. */
  layout(id: string): { lang: string; table: KeyTable } | undefined
  /** The layouts Windows has, in its order. */
  installed(): string[]
  exeOf(pid: number): string
  /** The keyboard helper's own program, never reported as the one typed in. */
  ownExe: string
  switchLayout(hwnd: bigint, layout: string): void
  press(keys: readonly Press[]): void
  /** Calls `typeFix` once the hook has answered. */
  later(): void
  caretOf(tid: number): Caret | undefined
  /** Whether Caps Lock is on, as the window in front sees it. */
  capsOf(front: Front): boolean
  send(message: KbdOut): void
  doubleClickMs: number
}

/** A mouse button or the wheel; `x-down` and `x-up` are a side button's, with its number (1 back, 2 forward). */
export type MouseEvent = 'left-down' | 'left-up' | 'other-down' | 'x-down' | 'x-up' | 'wheel'

const VK_BACK = 0x08
const VK_TAB = 0x09
const VK_RETURN = 0x0d
const VK_CAPITAL = 0x14
const VK_DELETE = 0x2e
const VK_A = 0x41
/** Keys that move the text cursor, PageUp to Down, and Delete. */
const MOVES = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, VK_DELETE])

/** Keys that type nothing, which programs press to keep Alt or Win from opening a menu (0xE8 is AutoHotkey's, 0xFF PowerToys'). */
export const MASK_KEYS: ReadonlySet<number> = new Set([0x07, 0xe8, 0xff])

/** Caps Lock is asked of Windows again when the last answer is older than this (Windows may turn it off on Shift). */
const CAPS_FRESH_MS = 1000
/** After Altype switches a window's layout, Windows may go on naming the old one for a while: the new one is trusted until Windows agrees, or this long. */
const SWITCH_TRUST_MS = 3000

/** A modifier tapped alone counts while held no longer than this. */
const TAP_MS = 600
/** The keys kept: enough for a few sentences. */
const MAX_RUN = 500

type Typed = Stroke & { end: boolean }
type Fix = { erase: number; text: string; key?: number; to: string; hwnd: bigint }

export class Typist {
  private config: KbdConfig = { keys: {}, autoFix: false, badge: false, cycle: [], fixApps: [], keepWords: [], words: {} }
  private keys: { action: KeyAction; spec: HotkeySpec }[] = []
  private keep = new Set<string>()
  private lexicons: Readonly<Record<string, Lexicon>> = {}

  /** The keys typed in the window `runWindow` since the last click, move or shortcut. */
  private run: Typed[] = []
  private runWindow = 0n
  /** What was done last: typing (the fix key fixes it), selecting (it converts the selection), or something else. */
  private last: 'typed' | 'selected' | 'none' = 'none'
  /** The last word fixed by itself, taken back by Backspace or the fix key right after. */
  private autoFixed: { start: number; end: number; from: string; word: string } | undefined
  /** The fix key's last conversion of typed keys: pressed again, it goes on to the next layout. */
  private cycling: { start: number; end: number; to: string } | undefined
  /** A fix waiting to be typed; keys pressed meanwhile wait for it, then are pressed again. */
  private pending: Fix | undefined
  private queued: { vk: number; scan: number; up: boolean }[] = []
  private held = new Set<number>()
  /** Keys whose press was a hotkey: their release is kept from the program too. */
  private swallowed = new Set<number>()
  /** A modifier pressed alone, and the modifiers pressed together since none was held. */
  private tap: { vk: number; since: number } | undefined
  private chord = { mods: new Set<Mod>(), clean: false }
  /** The last tap of a modifier: when it was let go, and the layout before it, if it switched one (a double takes that back). */
  private lastTap: { vk: number; at: number; before?: string } | undefined
  /** Side buttons that were a hotkey: their release is kept from the program too. */
  private swallowedButtons = new Set<number>()
  private lastDown: { x: number; y: number; time: number; double: boolean } | undefined
  private shownLayout = ''
  private reportedExe = ''
  /** Caps Lock, as last asked of Windows (or flipped by its key since), and when. */
  private caps = false
  private capsAt = Number.NEGATIVE_INFINITY
  /** The layout Altype last switched a window to, trusted over Windows' late answer. */
  private expected: { hwnd: bigint; layout: string; until: number } | undefined

  constructor(private readonly env: TypistEnv) {}

  configure(config: KbdConfig, lexicons: Readonly<Record<string, Lexicon>>): void {
    this.config = config
    this.keys = (Object.entries(config.keys) as [KeyAction, string][]).flatMap(([action, key]) => {
      const spec = parseHotkey(key)
      return spec ? [{ action, spec }] : []
    })
    this.keep = new Set(config.keepWords.map(w => w.toLowerCase()))
    this.lexicons = lexicons
  }

  /** The layouts the keys go through: those chosen that Windows has, or all of Windows'. */
  cycle(): string[] {
    const chosen = this.config.cycle.filter(id => this.env.layout(id))
    return chosen.length > 0 ? chosen : this.env.installed()
  }

  // ---------------------------------------------------------------- keys

  /**
   * A key went down or up; `own`: pressed by Altype itself; `foreign`: by
   * another program. True keeps it from the program.
   */
  key(vk: number, scan: number, down: boolean, own = false, foreign = false): boolean {
    if (own) return false
    if (foreign) {
      this.foreignKey(vk, down)
      return false
    }
    // Typed while a fix is on its way: pressed again after it.
    if (this.pending) {
      this.queued.push({ vk, scan, up: !down })
      return true
    }
    const mod = modOf(vk)
    if (!down) {
      this.held.delete(vk)
      if (mod) this.onModifierUp(vk)
      return this.swallowed.delete(vk)
    }
    const repeat = this.held.has(vk)
    this.held.add(vk)
    if (mod) {
      if (!repeat) this.onModifierDown(vk)
      return false
    }
    this.spoilTap()
    const mods = this.heldMods()
    const hotkey = this.hotkeyOf(vk, mods)
    if (hotkey) {
      this.swallowed.add(vk)
      if (!repeat) this.act(hotkey)
      return true
    }
    if (vk === VK_CAPITAL) {
      // Windows turns it as the key goes down; asked right now, it would not know yet.
      if (!repeat) {
        this.caps = !this.caps
        this.capsAt = this.env.now()
      }
      return false
    }
    return this.onTyping(vk, mods)
  }

  /** A mouse event; true keeps it from the program (a side button that is a hotkey). */
  /**
   * A key another program pressed (another layout switcher, a macro tool, Altype's
   * own copy and paste): it never makes or breaks a tap of the person's keys,
   * which another switcher reacting to a Ctrl tap would; a modifier still
   * counts as held; anything typed means the keys kept no longer match the text.
   */
  private foreignKey(vk: number, down: boolean): void {
    // A key that types nothing, pressed as Alt or Win is let go so no menu opens, is no key at all.
    if (MASK_KEYS.has(vk)) return
    if (!down) {
      this.held.delete(vk)
      return
    }
    this.held.add(vk)
    if (!modOf(vk)) {
      this.resetRun()
      this.last = 'none'
    }
  }

  mouse(event: MouseEvent, x: number, y: number, time: number, button = 0): boolean {
    if (event === 'x-down') {
      this.spoilTap()
      const mods = this.heldMods()
      const hit = this.keys.find(k => k.spec.kind === 'mouse' && k.spec.button === button && sameMods(mods, k.spec.mods))
      if (hit) {
        this.swallowedButtons.add(button)
        this.act(hit.action)
        return true
      }
      this.resetRun()
      this.last = 'none'
    } else if (event === 'x-up') {
      return this.swallowedButtons.delete(button)
    } else if (event === 'left-down') {
      this.spoilTap()
      this.resetRun()
      const d = this.lastDown
      const double = !!d && Math.abs(x - d.x) <= 4 && Math.abs(y - d.y) <= 4 && time - d.time <= this.env.doubleClickMs
      this.lastDown = { x, y, time, double }
      this.last = double ? 'selected' : 'none'
    } else if (event === 'left-up') {
      // A drag, a double or triple click, or a click with Shift selects.
      const d = this.lastDown
      if (d && (d.double || Math.abs(x - d.x) > 4 || Math.abs(y - d.y) > 4 || this.heldMods().has('Shift'))) this.last = 'selected'
    } else if (event === 'other-down') {
      this.spoilTap()
      this.resetRun()
      this.last = 'none'
    } else {
      // Ctrl with the wheel zooms: no tap.
      this.spoilTap()
    }
    return false
  }

  private heldMods(): Set<Mod> {
    const mods = new Set<Mod>()
    for (const vk of this.held) {
      const mod = modOf(vk)
      if (mod) mods.add(mod)
    }
    return mods
  }

  /** Which action a key press with these modifiers is. */
  private hotkeyOf(vk: number, mods: ReadonlySet<Mod>): KeyAction | undefined {
    return this.keys.find(({ spec }) => spec.kind === 'key' && spec.vk === vk && sameMods(mods, spec.mods))?.action
  }

  /** The action of a tap, a double tap or a chord. */
  private actionOf(kind: 'tap' | 'double', vk: number): KeyAction | undefined {
    return this.keys.find(({ spec }) => spec.kind === kind && spec.vk === vk)?.action
  }

  private act(action: KeyAction): void {
    if (action === 'switch') this.switchNext()
    else if (action === 'fix') this.fixKey()
    else this.env.send({ type: 'hotkey', action })
  }

  private resetRun(): void {
    // A new run asks Windows for Caps Lock again.
    this.capsAt = Number.NEGATIVE_INFINITY
    this.run = []
    this.autoFixed = undefined
    this.cycling = undefined
  }

  private spoilTap(): void {
    this.tap = undefined
    this.lastTap = undefined
    this.chord.clean = false
  }

  private onModifierDown(vk: number): void {
    const mod = modOf(vk) as Mod
    if ([...this.held].every(k => k === vk)) {
      this.tap = { vk, since: this.env.now() }
      this.chord = { mods: new Set([mod]), clean: true }
    } else {
      this.tap = undefined
      this.chord.mods.add(mod)
    }
  }

  private onModifierUp(vk: number): void {
    const t = this.tap
    this.tap = undefined
    if (t && t.vk === vk && this.chord.clean && this.env.now() - t.since <= TAP_MS) this.onTap(vk, t.since)
    else this.lastTap = undefined
    if ([...this.held].some(k => modOf(k))) return
    const { mods, clean } = this.chord
    if (clean && mods.size >= 2) {
      const chord = this.keys.find(({ spec }) => spec.kind === 'chord' && sameMods(mods, spec.mods))
      if (chord) this.act(chord.action)
    }
    this.chord = { mods: new Set(), clean: false }
  }

  /**
   * A modifier tapped alone, pressed at `since`: its tap acts at once; a
   * second tap soon after is the double, and takes back the first's layout
   * switch, so a tap can switch the layout without waiting to see if a
   * double comes.
   */
  private onTap(vk: number, since: number): void {
    const previous = this.lastTap
    this.lastTap = undefined
    const double = this.actionOf('double', vk)
    if (double && previous?.vk === vk && since - previous.at <= DOUBLE_MS) {
      if (previous.before) this.switchWindow(this.env.foreground().hwnd, previous.before)
      this.act(double)
      return
    }
    const tap = this.actionOf('tap', vk)
    const before = tap === 'switch' ? this.layoutNow(this.env.foreground()) : undefined
    if (tap) this.act(tap)
    this.lastTap = { vk, at: this.env.now(), ...(before ? { before } : {}) }
  }

  /** A key that is no hotkey and no modifier: typing, a move, a shortcut. True keeps it from the program. */
  private onTyping(vk: number, mods: ReadonlySet<Mod>): boolean {
    if (mods.has('Control') || mods.has('Alt') || mods.has('Super')) {
      this.last = vk === VK_A && mods.size === 1 ? 'selected' : 'none'
      this.resetRun()
      return false
    }
    const shift = mods.has('Shift')
    if (MOVES.has(vk)) {
      this.last = shift && vk !== VK_DELETE ? 'selected' : 'none'
      this.resetRun()
      return false
    }
    if (vk === VK_BACK) return this.onBackspace()
    const front = this.env.foreground()
    if (front.hwnd !== this.runWindow) {
      this.resetRun()
      this.runWindow = front.hwnd
    }
    this.reportApp(front.pid)
    const now = this.env.now()
    if (now - this.capsAt > CAPS_FRESH_MS) {
      this.caps = this.env.capsOf(front)
      this.capsAt = now
    }
    const layout = this.layoutNow(front)
    const info = this.env.layout(layout)
    const stroke: Stroke = { vk, shift, caps: this.caps, layout }
    if (vk === VK_RETURN || vk === VK_TAB) {
      const fixed = this.config.autoFix && !!info && this.autoFix(stroke, undefined, front)
      this.resetRun()
      this.last = 'none'
      return fixed
    }
    const char = info ? charOf(info.table, vk, shift, this.caps) : undefined
    if (char === undefined) {
      this.resetRun()
      this.last = 'none'
      return false
    }
    const end = this.endsWord(stroke, char)
    if (end && this.config.autoFix && this.autoFix(stroke, char, front)) return true
    this.autoFixed = undefined
    this.cycling = undefined
    this.run.push({ ...stroke, end })
    if (this.run.length > MAX_RUN) this.run.splice(0, this.run.length - MAX_RUN)
    this.last = 'typed'
    return false
  }

  private onBackspace(): boolean {
    if (this.autoFixed && this.autoFixed.end === this.run.length) {
      this.takeBack(this.autoFixed)
      return true
    }
    this.run.pop()
    this.autoFixed = undefined
    this.cycling = undefined
    return false
  }

  /** A key that ends a word: a space, or a sign that is no letter in any layout of the cycle ("!", "-", "/" which is "." in Russian). */
  private endsWord(stroke: Stroke, char: string): boolean {
    if (/\s/.test(char)) return true
    return this.cycle().every(id => {
      const info = this.env.layout(id)
      const c = info ? charOf(info.table, stroke.vk, stroke.shift, stroke.caps) : undefined
      return c === undefined || !/[\p{L}\p{N}'’ʼ`]/u.test(c)
    })
  }

  private reading(strokes: readonly Stroke[], id: string): Reading {
    const info = this.env.layout(id)
    return { layout: id, lang: info?.lang ?? '', text: info ? typeIn(strokes, info.table, l => this.env.layout(l)?.table) : '' }
  }

  // ---------------------------------------------------------------- fixing

  /** The first key of the word being typed: the one after the last key that ended a word. */
  private wordStart(): number {
    for (let i = this.run.length - 1; i >= 0; i--) if (this.run[i]?.end) return i + 1
    return 0
  }

  /**
   * A word ends with `stroke` (a space, a sign, Enter or Tab; `char` is what
   * it types, none for Enter and Tab): if it was typed in the wrong layout, it
   * is erased and typed again in the right one, the layout switched. True
   * when it is.
   */
  private autoFix(stroke: Stroke, char: string | undefined, front: Front): boolean {
    const start = this.wordStart()
    const word = this.run.slice(start)
    if (word.length < 2) return false
    const own = word[word.length - 1]?.layout as string
    if (word.some(s => s.layout !== own) || this.config.fixApps.includes(this.env.exeOf(front.pid))) return false
    const typed = this.reading(word, own)
    const others = this.cycle()
      .filter(id => id !== own)
      .map(id => this.reading(word, id))
    const choice = chooseFix(typed, others, this.lexicons, this.keep)
    if (!choice) return false
    // The window already types in the layout the word would go into: the keys were taken for the
    // layout Windows still named after a switch, and the word on screen is right as it is.
    if (choice.layout === this.layoutNow(front)) {
      for (const s of word) s.layout = choice.layout
      return false
    }
    const to = choice.layout
    const ending = char === undefined ? '' : this.reading([stroke], to).text || char
    for (const s of word) s.layout = to
    if (char !== undefined) this.run.push({ ...stroke, layout: to, end: true })
    this.autoFixed = char === undefined ? undefined : { start, end: this.run.length, from: own, word: coreOf(typed.text) ?? typed.text.toLowerCase() }
    this.cycling = undefined
    this.last = 'typed'
    this.schedule({ erase: word.length, text: choice.text + ending, ...(char === undefined ? { key: stroke.vk } : {}), to, hwnd: front.hwnd })
    return true
  }

  /** Backspace, or the fix key, right after a word was fixed by itself: it goes back as typed, and is kept so from now on. */
  private takeBack(fixed: NonNullable<Typist['autoFixed']>): void {
    this.autoFixed = undefined
    const strokes = this.run.slice(fixed.start, fixed.end)
    for (const s of strokes) s.layout = fixed.from
    this.env.send({ type: 'keep', word: fixed.word })
    this.keep.add(fixed.word)
    this.schedule({ erase: strokes.length, text: this.reading(strokes, fixed.from).text, to: fixed.from, hwnd: this.runWindow })
  }

  /**
   * The fix key: the last word, again in the layout that makes the best word
   * of it; pressed again, in the next layout round the cycle; or the
   * selection. Only the last word: a sweep back over the words before it
   * retyped whole lines when one word was meant.
   */
  private fixKey(): void {
    if (this.autoFixed && this.autoFixed.end === this.run.length) return this.takeBack(this.autoFixed)
    if (this.last === 'selected') {
      this.last = 'none'
      this.env.send({ type: 'selection', cycle: this.cycle() })
      return
    }
    if (this.last !== 'typed' || this.run.length === 0 || this.env.foreground().hwnd !== this.runWindow) return
    let start: number
    let to: string | undefined
    if (this.cycling && this.cycling.end === this.run.length) {
      start = this.cycling.start
      to = nextLayout(this.cycle(), this.cycling.to)
    } else {
      start = this.lastWordStart()
      const letters = this.run.slice(start).filter(s => !s.end)
      const own = this.run[this.run.length - 1]?.layout as string
      const others = this.cycle()
        .filter(id => id !== own)
        .map(id => this.reading(letters, id))
      to = bestLayout(this.reading(letters, own), others, this.lexicons)?.layout ?? nextLayout(this.cycle(), own)
    }
    if (!to) return
    const tail = this.run.slice(start)
    const text = this.reading(tail, to).text
    for (const s of tail) s.layout = to
    this.cycling = { start, end: this.run.length, to }
    this.autoFixed = undefined
    this.schedule({ erase: tail.length, text, to, hwnd: this.runWindow })
  }

  /** The first key of the last word, which takes the spaces and signs after it. */
  private lastWordStart(): number {
    let i = this.run.length
    while (i > 0 && this.run[i - 1]?.end) i--
    while (i > 0 && !this.run[i - 1]?.end) i--
    return i
  }

  private switchNext(): void {
    const front = this.env.foreground()
    const to = nextLayout(this.cycle(), this.layoutNow(front))
    if (to) this.switchWindow(front.hwnd, to)
  }

  /** Switches the window in front to a layout (after a selection was converted). */
  switchTo(layout: string): void {
    this.switchWindow(this.env.foreground().hwnd, layout)
  }

  /** Switches a window's layout, and trusts that layout until Windows names it too. */
  private switchWindow(hwnd: bigint, layout: string): void {
    this.env.switchLayout(hwnd, layout)
    this.expected = { hwnd, layout, until: this.env.now() + SWITCH_TRUST_MS }
  }

  /** The layout the window in front types in: the one Altype just switched it to, until Windows agrees; else Windows' answer. */
  private layoutNow(front: Front): string {
    const named = this.env.layoutOf(front.tid)
    const e = this.expected
    if (e && e.hwnd === front.hwnd && e.layout !== named && this.env.now() < e.until) return e.layout
    this.expected = undefined
    return named
  }

  // ---------------------------------------------------------------- typing the fix

  /** A fix is typed after the hook has answered: a hook must answer at once. */
  private schedule(fix: Fix): void {
    this.pending = fix
    this.queued = []
    this.env.later()
  }

  typeFix(): void {
    const fix = this.pending
    this.pending = undefined
    if (!fix) return
    // The layout first: Windows hands a program its posted messages before its typing.
    this.switchWindow(fix.hwnd, fix.to)
    const keys: Press[] = []
    for (let i = 0; i < fix.erase; i++) keys.push({ vk: VK_BACK })
    if (fix.text) keys.push({ char: fix.text })
    if (fix.key) keys.push({ vk: fix.key })
    // Keys typed meanwhile go again, as typing: the hook sees them anew.
    for (const again of this.queued) keys.push({ again })
    this.queued = []
    this.env.press(keys)
  }

  // ---------------------------------------------------------------- the badge and the program typed in

  /** Looks at the layout in front: a change is reported for the badge (not the first look). */
  lookAtLayout(): void {
    const front = this.env.foreground()
    if (!front.tid) return
    const layout = this.env.layoutOf(front.tid)
    if (layout === this.shownLayout) return
    const first = this.shownLayout === ''
    this.shownLayout = layout
    if (first) return
    const caret = this.env.caretOf(front.tid)
    this.env.send({ type: 'layout', layout, ...(caret ? { caret } : {}) })
  }

  /** The next look at the layout in front is a first one again. */
  forgetLayout(): void {
    this.shownLayout = ''
  }

  private reportApp(pid: number): void {
    const exe = this.env.exeOf(pid)
    if (!exe || exe === this.env.ownExe || exe === this.reportedExe) return
    this.reportedExe = exe
    this.env.send({ type: 'app', exe })
  }
}

function sameMods(a: ReadonlySet<Mod>, b: readonly Mod[]): boolean {
  return a.size === b.length && b.every(m => a.has(m))
}
