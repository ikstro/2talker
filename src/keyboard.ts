// The main process's side of the keyboard helper (kbd-worker.ts): the thread
// runs only while one of its parts is on (the switch key, fixing as one types,
// the fix key, the layout badge) and gets the settings each time they change.
// The badge itself is a small window that never takes focus or clicks.

import * as path from 'node:path'
import { MessageChannel, Worker } from 'node:worker_threads'

import { BrowserWindow, screen } from 'electron'
import koffi from 'koffi'

import { isAccelerator } from './hotkey'
import type { KbdConfig, KbdIn, KbdOut, KeyAction } from './typist'
import type { KeyboardLayout } from './protocol'
import { myLanguages, type Settings } from './settings'
import { installedLayouts } from './winkbd'

const user32 = koffi.load('user32.dll')
const PostThreadMessageW = user32.func('bool __stdcall PostThreadMessageW(uint32 tid, uint32 msg, uintptr w, intptr l)')
const WM_APP_PORT = 0x8000

/** The languages the layout fixer has word lists for (media/layout/<code>.txt). */
export const FIX_LANGUAGES = ['en', 'ru', 'uk']

const BADGE = { width: 36, height: 22 }
const BADGE_MS = 900

export type KeyboardEvents = {
  /** A fix was taken back: keep the word as typed from now on. */
  keep(word: string): void
  /** The fix key with a selection: convert it into the next of `cycle`. */
  selection(cycle: string[]): void
  /** A key Electron's shortcuts cannot hold, for selecting, snipping or a snip's text, was pressed. */
  hotkey(action: Exclude<KeyAction, 'switch' | 'fix'>): void
  /** The program typed in last. */
  app(exe: string): void
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
   * (a double tap of Ctrl, a side button of the mouse).
   */
  apply(s: Settings): void {
    const keys: Partial<Record<KeyAction, string>> = {}
    if (s.switchKey) keys.switch = s.switchKey
    if (s.fixKey) keys.fix = s.fixKey
    for (const [action, key] of [
      ['select', s.selectKey],
      ['snip', s.snipKey],
      ['translate', s.translateKey],
      ['text', s.textKey],
      ['dictate', s.dictateKey],
      ['english', s.englishKey],
      ['note', s.noteKey],
      ['again', s.againKey],
    ] as const) {
      if (key && !isAccelerator(key)) keys[action] = key
    }
    if (Object.keys(keys).length === 0 && !s.autoFix && !s.layoutBadge) return this.stop()
    const config: KbdConfig = {
      keys,
      autoFix: s.autoFix,
      badge: s.layoutBadge,
      cycle: s.layouts,
      languages: myLanguages(s),
      fixApps: s.fixApps,
      keepWords: s.keepWords,
      words: Object.fromEntries(FIX_LANGUAGES.map(code => [code, path.join(this.wordsDir, `${code}.txt`)])),
    }
    if (!this.worker) this.start()
    this.post({ type: 'config', config })
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
        this.showBadge(message.layout, message.caret)
        return
      case 'keep':
        this.events.keep(message.word)
        return
      case 'selection':
        this.events.selection(message.cycle)
        return
      case 'hotkey':
        this.events.hotkey(message.action)
        return
      case 'app':
        this.events.app(message.exe)
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

  private shortOf(layout: string): string {
    if (!this.shorts.has(layout)) for (const l of keyboardLayouts()) this.shorts.set(l.id, l.short)
    return this.shorts.get(layout) ?? '?'
  }

  /** Shows the layout's short name by the text cursor (physical pixels), or by the pointer when the program has no system cursor. */
  private showBadge(layout: string, caret: { x: number; y: number; h: number } | undefined): void {
    const win = this.badgeWindow()
    const at = caret ? screen.screenToDipPoint({ x: caret.x, y: caret.y + caret.h }) : screen.getCursorScreenPoint()
    const offset = caret ? { x: 0, y: 4 } : { x: 14, y: 20 }
    const area = screen.getDisplayNearestPoint(at).workArea
    const x = Math.round(Math.min(Math.max(area.x, at.x + offset.x), area.x + area.width - BADGE.width))
    const y = Math.round(Math.min(Math.max(area.y, at.y + offset.y), area.y + area.height - BADGE.height))
    win.setBounds({ x, y, ...BADGE })
    void win.webContents.executeJavaScript(`document.getElementById('badge').textContent = ${JSON.stringify(this.shortOf(layout))}`).catch(() => undefined)
    win.showInactive()
    if (this.badgeTimer) clearTimeout(this.badgeTimer)
    this.badgeTimer = setTimeout(() => win.hide(), BADGE_MS)
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
