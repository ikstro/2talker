// The main process's side of the keyboard helper (kbd-worker.ts): the thread
// runs only while one of its parts is on (the switch key, fixing as one types,
// the fix key, the layout badge) and gets the settings each time they change.
// The badge itself is a small window that never takes focus or clicks.

import * as path from 'node:path'
import { MessageChannel, Worker } from 'node:worker_threads'

import { BrowserWindow, screen } from 'electron'
import koffi from 'koffi'

import { isAccelerator } from './hotkey'
import type { LearnedConfig } from './learning'
import type { KbdConfig, KbdIn, KbdOut, KeyAction, Learned } from './typist'
import type { KeyboardLayout } from './protocol'
import { myLanguages, type Settings } from './settings'
import { caretOf, foreground, installedLayouts } from './winkbd'

const user32 = koffi.load('user32.dll')
const PostThreadMessageW = user32.func('bool __stdcall PostThreadMessageW(uint32 tid, uint32 msg, uintptr w, intptr l)')
const WM_APP_PORT = 0x8000

/** The languages the layout fixer has word lists for (media/layout/<code>.txt). */
export const FIX_LANGUAGES = ['en', 'ru', 'uk', 'bg', 'mk', 'el', 'he', 'ar', 'fa', 'ka']

const BADGE = { width: 36, height: 22 }
/** With Caps Lock on, the badge says so too ("EN ⇪"). */
const BADGE_CAPS_WIDTH = 54
const BADGE_MS = 900
/** A word the badge says while Altype works stays up to this long, unless taken down sooner. */
const SAY_MS = 15_000

type MainAction = Exclude<KeyAction, 'switch' | 'fix' | 'layout'>

export type KeyboardEvents = {
  /** A fix was taken back: keep the word as typed from now on. */
  keep(word: string): void
  /** The person fixed a word by hand; a word of theirs was typed right again (learning.ts). */
  fixedByHand(learned: Learned): void
  tally(hash: string, count: number, word?: Learned): void
  /** The fix key with a selection: convert it into the next of `cycle`. */
  selection(cycle: string[]): void
  /** A key Electron's shortcuts cannot hold, for selecting, snipping or a snip's text, was pressed. */
  hotkey(action: MainAction): void
  /** The program in front lately; whether it runs as administrator. */
  app(exe: string, elevated: boolean): void
  /** The layout in front, and Caps Lock (for the tray's icon). */
  layout(layout: string, caps: boolean): void
  /** Another program pressed keys by itself. */
  foreignKeys(): void
  failed(message: string): void
}

/** Windows' keyboard layouts for the settings: the language's name in English and its short tag. */
export function keyboardLayouts(): KeyboardLayout[] {
  const names = new Intl.DisplayNames(['en'], { type: 'language' })
  return installedLayouts().map(l => {
    let name = l.tag || l.id
    try {
      if (l.tag) name = names.of(l.tag) ?? l.tag
    } catch {
      // A tag Intl does not know keeps its own form.
    }
    return { id: l.id, name, short: (l.tag.split('-')[0] ?? l.id).toUpperCase(), lang: (l.tag.split('-')[0] ?? '').toLowerCase() }
  })
}

export class KeyboardHelper {
  private worker: Worker | undefined
  private port: import('node:worker_threads').MessagePort | undefined
  private tid = 0
  private badge: BrowserWindow | undefined
  private badgeTimer: NodeJS.Timeout | undefined
  private shorts = new Map<string, string>()

  constructor(
    private readonly workerPath: string,
    private readonly wordsDir: string,
    private readonly events: KeyboardEvents,
  ) {}

  /**
   * Starts, configures or ends the thread for these settings: the layout keys
   * are always its, the others only when Electron's shortcuts cannot hold them
   * (a double tap of Ctrl, a side button of the mouse). Paused, it keeps the
   * pause key only, when that is its.
   */
  apply(s: Settings, learned: LearnedConfig): void {
    const keys: KbdConfig['keys'] = {}
    const its = (key: string) => !!key && !isAccelerator(key)
    if (s.paused) {
      if (!its(s.pauseKey)) return this.stop()
      keys.pause = s.pauseKey
    } else {
      if (s.switchKey && s.switchOn) keys.switch = s.switchKey
      if (s.fixKey && s.fixKeyOn) keys.fix = s.fixKey
      for (const [action, key] of [
        ['select', s.selectKey],
        ['snip', s.snipKey],
        ['translate', s.translateKey],
        ['text', s.textKey],
        ['inPlace', s.inPlaceKey],
        ['dictate', s.dictateKey],
        ['english', s.englishKey],
        ['note', s.noteKey],
        ['again', s.againKey],
        ['pause', s.pauseKey],
        ['window', s.windowKey],
      ] as const) {
        if (its(key)) keys[action] = key
      }
    }
    const on = !s.paused
    const layoutKeys = on && s.switchOn ? s.layoutKeys : {}
    const apps = Object.fromEntries(s.apps.map(a => [a.exe, { off: a.off, layout: a.layout }]))
    const watched = on && (s.autoFix || s.layoutBadge || s.trayLayout || Object.keys(layoutKeys).length > 0 || s.apps.some(a => a.layout))
    if (Object.keys(keys).length === 0 && !watched) return this.stop()
    const config: KbdConfig = {
      keys,
      layoutKeys,
      autoFix: on && s.autoFix,
      fixTwoCaps: s.fixTwoCaps,
      fixCapsLock: s.fixCapsLock,
      keepCaps: s.keepCaps,
      fixOnPause: s.fixOnPause,
      fixSound: s.fixSound,
      clickFile: path.join(path.dirname(this.wordsDir), 'fix.wav'),
      badge: on && s.layoutBadge,
      trayLayout: on && s.trayLayout,
      cycle: s.layouts,
      languages: myLanguages(s),
      apps: on ? apps : {},
      keepWords: s.keepWords,
      learn: on && s.learn,
      ...learned,
      quietFullScreen: s.quietFullScreen,
      words: Object.fromEntries(FIX_LANGUAGES.map(code => [code, path.join(this.wordsDir, `${code}.txt`)])),
    }
    if (!this.worker) this.start()
    this.post({ type: 'config', config })
  }

  /** The main process converted the selection and selected it again: the fix key goes on with it. */
  selected(): void {
    this.post({ type: 'selected' })
  }

  /** Switches the window in front to a layout. */
  switchTo(layout: string): void {
    this.post({ type: 'switchTo', layout })
  }

  dispose(): void {
    this.stop()
    this.badge?.destroy()
    this.badge = undefined
  }

  private start(): void {
    const { port1, port2 } = new MessageChannel()
    const worker = new Worker(this.workerPath, { workerData: { port: port2 }, transferList: [port2] })
    this.worker = worker
    this.port = port1
    this.tid = 0
    port1.on('message', (message: KbdOut) => this.onMessage(message))
    worker.on('error', error => this.events.failed(error.message))
    worker.on('exit', () => {
      if (this.worker !== worker) return
      this.worker = undefined
      this.port?.close()
      this.port = undefined
    })
  }

  private stop(): void {
    const worker = this.worker
    if (!worker) return
    this.post({ type: 'quit' })
    this.worker = undefined
    this.port?.close()
    this.port = undefined
    // The thread unhooks and ends by itself; a stuck one is ended anyway.
    setTimeout(() => void worker.terminate(), 1000)
  }

  private post(message: KbdIn): void {
    this.port?.postMessage(message)
    if (this.tid) PostThreadMessageW(this.tid, WM_APP_PORT, 0, 0)
  }

  private onMessage(message: KbdOut): void {
    switch (message.type) {
      case 'thread':
        this.tid = message.tid
        PostThreadMessageW(this.tid, WM_APP_PORT, 0, 0)
        return
      case 'layout':
        if (message.badge) this.showBadge(message.layout, message.caps, message.caret)
        this.events.layout(message.layout, message.caps)
        return
      case 'keep':
        this.events.keep(message.word)
        return
      case 'fixedByHand':
        this.events.fixedByHand({ word: message.word, lang: message.lang })
        return
      case 'tally':
        this.events.tally(message.hash, message.count, message.word)
        return
      case 'selection':
        this.events.selection(message.cycle)
        return
      case 'hotkey':
        this.events.hotkey(message.action)
        return
      case 'app':
        this.events.app(message.exe, message.elevated)
        return
      case 'foreignKeys':
        this.events.foreignKeys()
        return
      case 'error':
        this.events.failed(message.message)
        return
    }
  }

  // ---------------------------------------------------------------- the badge

  shortOf(layout: string): string {
    if (!this.shorts.has(layout)) for (const l of keyboardLayouts()) this.shorts.set(l.id, l.short)
    return this.shorts.get(layout) ?? '?'
  }

  /** A word in the badge by the text cursor while Altype works there (Translate in place); empty hides it. */
  say(text: string): void {
    if (!text) {
      if (this.badgeTimer) clearTimeout(this.badgeTimer)
      if (this.badge && !this.badge.isDestroyed()) this.badge.hide()
      return
    }
    const front = foreground()
    this.showBadgeText(text, { width: BADGE.width, height: BADGE.height }, front.tid ? caretOf(front.tid) : undefined, SAY_MS)
  }

  /** Shows the layout's short name (and Caps Lock, when on) by the text cursor (physical pixels), or by the pointer when the program has no system cursor. */
  private showBadge(layout: string, caps: boolean, caret: { x: number; y: number; h: number } | undefined): void {
    const size = { width: caps ? BADGE_CAPS_WIDTH : BADGE.width, height: BADGE.height }
    this.showBadgeText(`${this.shortOf(layout)}${caps ? ' ⇪' : ''}`, size, caret, BADGE_MS)
  }

  private showBadgeText(text: string, size: { width: number; height: number }, caret: { x: number; y: number; h: number } | undefined, ms: number): void {
    const win = this.badgeWindow()
    const at = caret ? screen.screenToDipPoint({ x: caret.x, y: caret.y + caret.h }) : screen.getCursorScreenPoint()
    const offset = caret ? { x: 0, y: 4 } : { x: 14, y: 20 }
    const area = screen.getDisplayNearestPoint(at).workArea
    const x = Math.round(Math.min(Math.max(area.x, at.x + offset.x), area.x + area.width - size.width))
    const y = Math.round(Math.min(Math.max(area.y, at.y + offset.y), area.y + area.height - size.height))
    win.setBounds({ x, y, ...size })
    void win.webContents.executeJavaScript(`document.getElementById('badge').textContent = ${JSON.stringify(text)}`).catch(() => undefined)
    win.showInactive()
    if (this.badgeTimer) clearTimeout(this.badgeTimer)
    this.badgeTimer = setTimeout(() => win.hide(), ms)
  }

  private badgeWindow(): BrowserWindow {
    if (this.badge && !this.badge.isDestroyed()) return this.badge
    const win = new BrowserWindow({
      ...BADGE,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true)
    void win.loadFile(path.join(path.dirname(this.wordsDir), 'badge.html'))
    this.badge = win
    return win
  }
}
