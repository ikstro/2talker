// Dictate: a key, in any program, starts recording in the badge (a small
// window at the bottom of the screen being typed in, where the person last
// dropped it, that never takes the focus, so the program keeps it); the same
// key again stops. Then, by the key:
//   type     the text is typed where the cursor is (through the clipboard,
//            which is put back as it was),
//   english  the same, translated into English first by Altype's translator,
//   note     the recording goes into the knowledge base as a .md file
//            (through the engine's library), and a balloon says where.
// Esc while recording throws it away. Typed phrases go into the log
// (dictationlog.ts), so the again key can type the last one once more.

import * as path from 'node:path'

import { BrowserWindow, globalShortcut, screen, shell } from 'electron'

import type { DictationLog } from './dictationlog'
import { frameWindow, WIN11 } from './dwm'
import { log } from './log'
import { badgeOffset, placeBadge, type Rect } from './placement'
import type { DictationMode, ToHost, ToView } from './protocol'
import type { Settings } from './settings'
import type { SpeechHost } from './speechhost'
import { foreground, windowRect } from './winkbd'

/** The badge is as wide as this; as tall as its page, from one line of words to about six (then they scroll). */
const BADGE = { width: 360, min: 64, max: 180 }
const NOTE_WAIT_MS = 5 * 60_000
/** The most languages the engine weighs a phrase against. */
const MOST_EXPECTED = 8

export type DictationOptions = {
  page: string
  preload: string
  background: () => string
  /** The badge's edge, drawn by Windows 11 (dwm.ts). */
  border: () => string
  speech: SpeechHost
  /** Types the text in the program in front, the clipboard kept. */
  paste: (text: string) => Promise<void>
  /** The text in English; `from` is the language the engine heard. */
  toEnglish: (text: string, from: string) => Promise<string>
  /** The languages the person uses (their own, English, the others they named): a phrase is taken as one of them, never another. */
  expected: () => string[]
  /** The language of a text by its letters and words (translate.ts), when Whisper was unsure. */
  languageOf: (text: string) => string
  balloon: (title: string, content: string, click?: () => void) => void
  /** The engine is not installed yet: Dictate's page offers it. */
  needsEngine: () => void
  /** The app window on a transcript: a note that stayed in Transcripts. */
  openTranscript: (id: string) => void
  onChange: () => void
  /** The phrases typed lately. */
  log: DictationLog
  /** A phrase went into the log, or the log was cleared: the Dictate page shows the latest. */
  logged: () => void
  /** Where the person last dropped the badge, from the bottom centre of the work area; and keeping a new place. */
  offset: () => Settings['dictationBadge']
  moved: (offset: Settings['dictationBadge']) => void
}

type Transcript = { title: string; note?: string; noteError?: string }
type Row = { status: string; error: string }

export class Dictation {
  state: 'idle' | 'recording' | 'working' = 'idle'
  mode: DictationMode = 'type'
  private badge: BrowserWindow | undefined
  private badgeReady = false
  private waiting: ToView[] = []
  /** The engine is being asked for a session: a second press now would come before the badge starts. */
  private opening = false
  /** The height the badge's page asked for: its bottom edge stays where it is when it changes. */
  private height = BADGE.min

  constructor(private readonly o: DictationOptions) {}

  /** A Dictate key: the first press starts, the next one (any of the three) stops. */
  press(mode: DictationMode, key: string): void {
    if (this.opening) return
    if (this.state === 'idle') void this.start(mode, key)
    else if (this.state === 'recording') this.stop()
  }

  private async start(mode: DictationMode, key: string): Promise<void> {
    if (!this.o.speech.installed) return this.o.needsEngine()
    if (!this.o.speech.ready) {
      this.o.balloon('Altype', 'The speech engine is starting. Try again in a few seconds.')
      return
    }
    this.mode = mode
    // The screen to show on is the one with the window the text goes into, taken now, while it is in front.
    const area = this.workArea()
    this.set('recording')
    const expected = this.o.expected().slice(0, MOST_EXPECTED)
    let session: string | undefined
    if (mode !== 'note') {
      // Heard while it is spoken (the engine loads its model meanwhile); an engine without sessions gets the phrase whole.
      this.opening = true
      try {
        const r = await this.o.speech.call<{ id: string }>('POST', '/dictate/sessions', { expected, strict: true })
        if (r.ok) session = r.data.id
        else void this.o.speech.call('POST', '/dictate/prepare')
      } finally {
        this.opening = false
      }
    }
    if (this.state !== 'recording') return
    const badge = this.window()
    this.height = BADGE.min
    const place = placeBadge(this.o.offset(), { width: BADGE.width, height: this.height }, area)
    badge.setBounds(place)
    badge.showInactive()
    log(`badge: shown at ${JSON.stringify(badge.getBounds())} (asked ${JSON.stringify(place)}, area ${JSON.stringify(area)}, offset ${JSON.stringify(this.o.offset())}), visible ${badge.isVisible()}, session ${session ? 'yes' : 'no'}`)
    this.send({ type: 'dictation', command: 'start', mode, key, ...(session ? { session } : {}), expected })
    globalShortcut.register('Escape', () => this.cancel())
  }

  private stop(): void {
    this.set('working')
    // Esc stays: while the text is finished, it throws the phrase away (a note is saved regardless).
    if (this.mode === 'note') globalShortcut.unregister('Escape')
    this.send({ type: 'dictation', command: 'stop', mode: this.mode, key: '' })
  }

  cancel(): void {
    if (this.state !== 'recording' && !(this.state === 'working' && this.mode !== 'note')) return
    globalShortcut.unregister('Escape')
    this.send({ type: 'dictation', command: 'cancel', mode: this.mode, key: '' })
  }

  /** The badge's messages; true when the message was the badge's. */
  onMessage(message: ToHost): boolean {
    switch (message.type) {
      case 'dictationReady':
        this.badgeReady = true
        for (const m of this.waiting.splice(0)) this.send(m)
        return true
      case 'dictationAudio':
        void this.typePhrase(message.mode, message.audio)
        return true
      case 'dictationText':
        void this.typeHeard(message.mode, message.text, message.language, message.sure)
        return true
      case 'dictationNote':
        void this.awaitNote(message.id)
        return true
      case 'dictationHeight':
        this.fit(message.px)
        return true
      case 'dictationCancelled':
        this.over()
        this.badge?.hide()
        return true
      case 'dictationFailed':
        this.fail(message.message)
        return true
      default:
        return false
    }
  }

  private async typePhrase(mode: DictationMode, audio: Uint8Array): Promise<void> {
    const expected = this.o.expected().slice(0, MOST_EXPECTED).map(encodeURIComponent).join(',')
    // strict: a phrase is never taken for a language the person does not use.
    const r = await this.o.speech.call<{ text: string; language: string; sure?: number }>('POST', `/dictate?language=auto&expected=${expected}&strict=1`, audio)
    if (!r.ok) return this.fail(r.error)
    // An engine before 0.2 says nothing of how sure it is: its language is taken as it is.
    await this.typeHeard(mode, r.data.text, r.data.language, r.data.sure ?? 1)
  }

  /** A recognized phrase typed where the cursor is; in English first for the English key. */
  private async typeHeard(mode: DictationMode, heard: string, language: string, sure: number): Promise<void> {
    if (this.state !== 'working') return
    let text = heard.trim()
    if (!text) return this.fail('Nothing was heard')
    try {
      // Whisper unsure, or a model that does not say (Parakeet): the language by the text's letters and words.
      const spoken = language && sure >= 0.5 ? language : this.o.languageOf(text)
      if (mode === 'english' && spoken !== 'en') text = await this.o.toEnglish(text, spoken)
    } catch (error) {
      return this.fail(`Could not translate: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.badge?.hide()
    this.over()
    await this.o.paste(text)
    this.o.log.add(mode === 'english' ? { mode, text, heard } : { mode: 'type', text })
    this.o.logged()
  }

  /** The again key: the last phrase typed once more where the cursor is (not logged again). */
  typeAgain(): void {
    if (this.state !== 'idle' || this.opening) return
    const last = this.o.log.last()
    if (!last) return this.o.balloon('Altype', 'Nothing dictated yet')
    this.o.paste(last.text).catch(error => console.warn('Altype: could not type the phrase again', error))
  }

  clearLog(): void {
    this.o.log.clear()
    this.o.logged()
  }

  private async awaitNote(id: string): Promise<void> {
    const until = Date.now() + NOTE_WAIT_MS
    while (Date.now() < until) {
      const r = await this.o.speech.call<{ row: Row; transcript: Transcript | null }>('GET', `/transcripts/${id}`)
      if (r.ok && r.data.row.status === 'done' && r.data.transcript) {
        const t = r.data.transcript
        this.over()
        if (t.note) {
          const file = t.note
          this.send({ type: 'dictationDone', text: path.basename(file, '.md') })
          this.o.balloon('Note saved', `${path.basename(file)}\nClick to open it.`, () => void shell.openPath(file))
        } else {
          this.send({ type: 'dictationDone', text: t.title })
          this.o.balloon('The note is in Transcripts', t.noteError ?? 'No knowledge base folder is chosen yet: choose one on the Dictate page.', () => this.o.openTranscript(id))
        }
        this.hideSoon(2200)
        return
      }
      if (r.ok && r.data.row.status === 'failed') return this.fail(r.data.row.error || 'Could not transcribe the note')
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    this.over()
    this.badge?.hide()
  }

  private fail(message: string): void {
    this.over()
    this.send({ type: 'dictationError', message })
    this.hideSoon(3500)
  }

  private over(): void {
    globalShortcut.unregister('Escape')
    this.set('idle')
  }

  private hideSoon(ms: number): void {
    setTimeout(() => {
      if (this.state === 'idle') this.badge?.hide()
    }, ms)
  }

  private set(state: Dictation['state']): void {
    this.state = state
    this.o.onChange()
  }

  private send(message: ToView): void {
    const badge = this.window()
    if (this.badgeReady) badge.webContents.send('to-view', message)
    else this.waiting.push(message)
  }

  private window(): BrowserWindow {
    if (this.badge && !this.badge.isDestroyed()) return this.badge
    const b = new BrowserWindow({
      width: BADGE.width,
      height: BADGE.min,
      show: false,
      frame: false,
      resizable: false,
      // Its status line is a drag region (dictation.css): the person puts it where it bothers least.
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      // The program being typed in keeps the focus, so the text lands there.
      focusable: false,
      title: 'Altype dictation',
      backgroundColor: this.o.background(),
      webPreferences: { preload: this.o.preload, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false },
    })
    frameWindow(b, { corner: 'round', border: this.o.border() })
    b.setAlwaysOnTop(true, 'pop-up-menu')
    b.removeMenu()
    b.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    b.webContents.on('will-navigate', event => event.preventDefault())
    // 'moved' comes once, when a drag by the person ends (never for setBounds).
    b.on('moved', () => this.dropped())
    b.on('closed', () => {
      this.badge = undefined
      this.badgeReady = false
    })
    b.on('hide', () => log(`badge: hidden, state ${this.state}`))
    b.webContents.on('did-fail-load', (_event, code, description) => log(`badge: the page did not load: ${code} ${description}`))
    b.webContents.on('console-message', m => log(`badge page: ${m.message} (${m.sourceId}:${m.lineNumber})`))
    void b.loadFile(this.o.page, WIN11 ? { query: { frame: 'dwm' } } : undefined)
    log(`badge: window made, page ${this.o.page}`)
    this.badge = b
    return b
  }

  /** The theme changed: the badge's ground and edge in its colors. */
  reframe(): void {
    const b = this.badge
    if (!b || b.isDestroyed()) return
    b.setBackgroundColor(this.o.background())
    frameWindow(b, { corner: 'round', border: this.o.border() })
  }

  /**
   * The work area of the screen holding the window in front (the one the text
   * goes into); with no window there, or one Windows gives no size, the
   * screen under the pointer.
   */
  private workArea(): Rect {
    try {
      const rect = windowRect(foreground().hwnd)
      if (rect) return screen.getDisplayMatching(screen.screenToDipRect(null, rect)).workArea
    } catch (error) {
      console.warn('Altype: could not find the window in front', error)
    }
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
  }

  /** The page's new height, the bottom edge kept, inside the work area. */
  private fit(px: number): void {
    const b = this.badge
    if (!b || b.isDestroyed() || !Number.isFinite(px)) return
    const height = Math.round(Math.min(BADGE.max, Math.max(BADGE.min, px)))
    if (height === this.height) return
    this.height = height
    const now = b.getBounds()
    const area = screen.getDisplayMatching(now).workArea
    const y = Math.max(area.y, now.y + now.height - height)
    b.setBounds({ x: now.x, y, width: BADGE.width, height })
    log(`badge: page ${px} px → ${JSON.stringify(b.getBounds())} from ${JSON.stringify(now)}, visible ${b.isVisible()}`)
  }

  /** The person dropped the badge: the place is kept from that screen's bottom centre, for every screen. */
  private dropped(): void {
    const b = this.badge
    if (!b || b.isDestroyed()) return
    const bounds = b.getBounds()
    this.o.moved(badgeOffset(bounds, screen.getDisplayMatching(bounds).workArea))
  }

  dispose(): void {
    this.badge?.destroy()
  }
}
