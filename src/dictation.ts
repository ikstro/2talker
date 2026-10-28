// Dictate: a key, in any program, starts recording in the badge (a small
// window by the pointer that never takes the focus, so the program being
// typed in keeps it); the same key again stops. Then, by the key:
//   type     the text is typed where the cursor is (through the clipboard,
//            which is put back as it was),
//   english  the same, translated into English first by Altype's translator,
//   note     the recording goes into the knowledge base as a .md file
//            (through the engine's library), and a balloon says where.
// Esc while recording throws it away.

import * as path from 'node:path'

import { BrowserWindow, globalShortcut, screen, shell } from 'electron'

import type { DictationMode, ToHost, ToView } from './protocol'
import type { SpeechHost } from './speechhost'

const BADGE = { width: 300, height: 64 }
const NOTE_WAIT_MS = 5 * 60_000

export type DictationOptions = {
  page: string
  preload: string
  background: () => string
  speech: SpeechHost
  /** Types the text in the program in front, the clipboard kept. */
  paste: (text: string) => Promise<void>
  /** The text in English; `from` is the language the engine heard. */
  toEnglish: (text: string, from: string) => Promise<string>
  balloon: (title: string, content: string, click?: () => void) => void
  /** The engine is not installed yet: Dictate's page offers it. */
  needsEngine: () => void
  /** The app window on a transcript: a note that stayed in Transcripts. */
  openTranscript: (id: string) => void
  onChange: () => void
}

type Transcript = { title: string; note?: string; noteError?: string }
type Row = { status: string; error: string }

export class Dictation {
  state: 'idle' | 'recording' | 'working' = 'idle'
  mode: DictationMode = 'type'
  private badge: BrowserWindow | undefined
  private badgeReady = false
  private waiting: ToView[] = []

  constructor(private readonly o: DictationOptions) {}

  /** A Dictate key: the first press starts, the next one (any of the three) stops. */
  press(mode: DictationMode, key: string): void {
    if (this.state === 'idle') this.start(mode, key)
    else if (this.state === 'recording') this.stop()
  }

  private start(mode: DictationMode, key: string): void {
    if (!this.o.speech.installed) return this.o.needsEngine()
    if (!this.o.speech.ready) {
      this.o.balloon('Altype', 'The speech engine is starting. Try again in a few seconds.')
      return
    }
    // The model loads while the person speaks, so the phrase comes back at once.
    if (mode !== 'note') void this.o.speech.call('POST', '/dictate/prepare')
    this.mode = mode
    this.set('recording')
    const badge = this.window()
    this.place(badge)
    badge.showInactive()
    this.send({ type: 'dictation', command: 'start', mode, key })
    globalShortcut.register('Escape', () => this.cancel())
  }

  private stop(): void {
    this.set('working')
    globalShortcut.unregister('Escape')
    this.send({ type: 'dictation', command: 'stop', mode: this.mode, key: '' })
  }

  cancel(): void {
    if (this.state !== 'recording') return
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
      case 'dictationNote':
        void this.awaitNote(message.id)
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
    const r = await this.o.speech.call<{ text: string; language: string }>('POST', '/dictate?language=auto', audio)
    if (!r.ok) return this.fail(r.error)
    let text = r.data.text.trim()
    if (!text) return this.fail('Nothing was heard')
    try {
      if (mode === 'english' && r.data.language !== 'en') text = await this.o.toEnglish(text, r.data.language)
    } catch (error) {
      return this.fail(`Could not translate: ${error instanceof Error ? error.message : String(error)}`)
    }
    this.badge?.hide()
    this.over()
    await this.o.paste(text)
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
      ...BADGE,
      show: false,
      frame: false,
      resizable: false,
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
    b.setAlwaysOnTop(true, 'pop-up-menu')
    b.removeMenu()
    b.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    b.webContents.on('will-navigate', event => event.preventDefault())
    b.on('closed', () => {
      this.badge = undefined
      this.badgeReady = false
    })
    void b.loadFile(this.o.page)
    this.badge = b
    return b
  }

  private place(b: BrowserWindow): void {
    const at = screen.getCursorScreenPoint()
    const area = screen.getDisplayNearestPoint(at).workArea
    const x = Math.min(Math.max(at.x + 16, area.x + 8), area.x + area.width - BADGE.width - 8)
    const y = Math.min(Math.max(at.y + 20, area.y + 8), area.y + area.height - BADGE.height - 8)
    b.setBounds({ x, y, ...BADGE })
  }

  dispose(): void {
    this.badge?.destroy()
  }
}
