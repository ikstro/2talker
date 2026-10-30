// Dictate's badge at the bottom of the screen. The main process says when to
// start, stop or throw away; the badge records, shows the phrase as the engine
// hears it (recognized while it is spoken), the time and the level, and then
// hands over the text (to be typed) or finishes the note in the engine. Its
// window follows the panel's height; the keys are on the Dictate page, not here.

import type { DictationMode, ToView, TutorHost } from '../protocol'
import { el } from './dom'
import { ChunkRecorder, micTrouble, PhraseRecorder, StreamRecorder, type StreamStatus } from './recorder'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

const host = window.tutorHost
const root = document.getElementById('badge')!
const TITLES: Record<DictationMode, string> = { type: 'Dictate', english: 'Dictate in English', note: 'A note', check: 'Practice English' }

type Recorder = PhraseRecorder | ChunkRecorder | StreamRecorder
let recorder: Recorder | undefined
let mode: DictationMode = 'type'
/** The microphone and the engine are still being asked: a quick stop waits for them. */
let starting: Promise<void> = Promise.resolve()
let timer: number | undefined
/** The text being finished was thrown away (Esc while typing): its answer is not typed. */
let dropped = false
/** Seconds of sound waiting behind the piece being recognized: the engine is behind the voice. */
const BEHIND = 4
let words: HTMLElement | undefined
let dot: HTMLElement | undefined
let time: HTMLElement | undefined
/** The phrase heard so far, kept for the panel while it is typed. */
let said = ''
/** The model is being fetched: its progress stands in the time's place. */
let fetching = false

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The panel: the words on top (none when there are none to show), the status line under them. */
function show(kind: string, text: HTMLElement | null, ...line: (Node | string)[]): void {
  root.className = `badge ${kind}`
  root.replaceChildren(...(text ? [text] : []), el('div', { class: 'line' }, ...line))
  if (text) toEnd(text)
}

/** The latest words in view; the top fades when earlier ones are above. */
function toEnd(text: HTMLElement): void {
  text.scrollTop = text.scrollHeight
  text.classList.toggle('more', text.scrollHeight > text.clientHeight + 1)
}

/** The words area: the phrase, or a muted line while there is none yet. */
function wordsOf(text: string, waiting = ''): HTMLElement {
  return el('div', { class: text ? 'words' : 'words waiting' }, text || waiting)
}

/** The whole phrase the engine heard so far; behind: the voice is ahead of the engine. */
function onStatus(status: StreamStatus): void {
  if (!words || !dot || !time) return
  const model = status.model
  fetching = model?.state === 'downloading'
  if (fetching) time.textContent = `Getting the speech model ${Math.round((model?.progress ?? 0) * 100)}%`
  time.classList.toggle('fetch', fetching)
  const text = status.heard.trim()
  if (text && text !== said) {
    said = text
    words.textContent = text
    words.classList.remove('waiting')
    toEnd(words)
  }
  dot.classList.toggle('behind', status.pending > BEHIND)
  dot.title = status.pending > BEHIND ? 'catching up' : ''
}

/** The wave: the last three seconds of sound, one bar per 50 ms. */
const WAVE = 60
const STEP = 3
const BAR = 2
const levels: number[] = new Array<number>(WAVE).fill(0)
let wave: HTMLCanvasElement | undefined
let frame: number | undefined
/** New levels came in since the wave was last drawn. */
let fresh = false

function hear(level: number): void {
  levels.push(level)
  if (levels.length > WAVE) levels.shift()
  fresh = true
}

/** Each bar mirrored round the middle, newest at the right edge; silence is a row of 2 px dots. */
function draw(): void {
  frame = requestAnimationFrame(draw)
  if (!wave) return
  const ratio = devicePixelRatio || 1
  const w = wave.clientWidth
  const h = wave.clientHeight
  const sized = wave.width === Math.round(w * ratio) && wave.height === Math.round(h * ratio)
  if (!fresh && sized) return
  fresh = false
  if (!sized) {
    wave.width = Math.round(w * ratio)
    wave.height = Math.round(h * ratio)
  }
  const c = wave.getContext('2d')
  if (!c) return
  c.setTransform(ratio, 0, 0, ratio, 0, 0)
  c.clearRect(0, 0, w, h)
  // A mark that only has to be seen (--mark): the duck's marigold on light, its yellow on dark.
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--mark').trim()
  c.globalAlpha = 0.7
  const shown = Math.min(WAVE, Math.floor(w / STEP))
  for (let i = 0; i < shown; i++) {
    const bar = Math.max(2, Math.round(levels[WAVE - shown + i]! * h))
    c.fillRect(w - (shown - i) * STEP, (h - bar) / 2, BAR, bar)
  }
}

/** The clock, the levels and the wave stop together. */
function quiet(): void {
  clearInterval(timer)
  timer = undefined
  if (frame !== undefined) cancelAnimationFrame(frame)
  frame = undefined
  wave = undefined
}

function recording(): void {
  quiet()
  time = el('span', { class: 'time' }, '0:00')
  wave = el('canvas', { class: 'wave' })
  dot = el('span', { class: 'dot' })
  words = wordsOf('', 'Listening…')
  said = ''
  fetching = false
  show('rec', words, dot, el('span', { class: 'what' }, TITLES[mode]), time, wave)
  // A new phrase's window starts at its smallest: told the panel's height even when it is the last one's.
  postHeight(true)
  // A new phrase starts flat: nothing of the last one's sound.
  levels.fill(0)
  fresh = true
  // One tick per 50 ms: the clock, and the levels. A stream hands over every 50 ms it heard;
  // the others are asked how loud it is now.
  timer = window.setInterval(() => {
    if (!recorder || !time) return
    if (!fetching) time.textContent = clock(recorder.seconds)
    if (recorder instanceof StreamRecorder) for (const level of recorder.levels()) hear(level)
    else hear(recorder.level())
  }, 50)
  frame = requestAnimationFrame(draw)
}

async function start(next: DictationMode, session?: string, expected: string[] = []): Promise<void> {
  mode = next
  dropped = false
  recorder =
    mode === 'note'
      ? new ChunkRecorder(host.call, { source: 'note', slice: 2000 })
      : session
        ? new StreamRecorder(host.call, session, expected, onStatus)
        : new PhraseRecorder()
  recording()
  try {
    starting = recorder.start()
    await starting
  } catch (error) {
    recorder = undefined
    quiet()
    host.post({ type: 'dictationFailed', message: micTrouble(error) })
  }
}

async function stop(): Promise<void> {
  await starting.catch(() => undefined)
  quiet()
  const r = recorder
  recorder = undefined
  if (!r) return
  const behind = dot?.classList.contains('behind')
  show('busy', said ? wordsOf(said) : null, el('span', { class: 'spin' }), el('span', { class: 'what' }, mode === 'note' ? 'Saving the note…' : behind ? 'Catching up…' : mode === 'check' ? 'Checking…' : 'Typing…'))
  busy = r
  try {
    if (r instanceof ChunkRecorder) host.post({ type: 'dictationNote', id: await r.finish() })
    else if (r instanceof StreamRecorder) {
      const result = await r.finish()
      if (!dropped) host.post({ type: 'dictationText', mode, text: result.text, language: result.language, sure: result.sure })
    } else host.post({ type: 'dictationAudio', mode, audio: await r.finish() })
  } catch (error) {
    if (!dropped) host.post({ type: 'dictationFailed', message: error instanceof Error ? error.message : String(error) })
  } finally {
    if (busy === r) busy = undefined
  }
}

/** The recorder whose text is being finished now: Esc throws it away too. */
let busy: Recorder | undefined

async function cancel(): Promise<void> {
  await starting.catch(() => undefined)
  quiet()
  const r = recorder ?? busy
  recorder = undefined
  busy = undefined
  dropped = true
  await r?.cancel()
  host.post({ type: 'dictationCancelled' })
}

window.addEventListener('message', event => {
  const message = event.data as ToView
  if (event.source !== window || !message || typeof message.type !== 'string') return
  if (message.type === 'dictation') {
    if (message.command === 'start') void start(message.mode, message.session, message.expected)
    else if (message.command === 'stop') void stop()
    else void cancel()
  } else if (message.type === 'dictationDone') {
    show('done', wordsOf(message.text), el('span', { class: 'check' }, '✓'), el('span', { class: 'what' }, mode === 'note' ? 'Saved' : 'Typed'))
  } else if (message.type === 'dictationError') {
    show('error', wordsOf(message.message), el('span', { class: 'what' }, mode === 'note' ? 'The note was not saved' : 'Nothing typed'))
  }
})

// The window is as tall as the panel: the main process keeps its bottom edge in place.
let posted = 0
function postHeight(again = false): void {
  const px = Math.ceil(root.getBoundingClientRect().height)
  if (px === posted && !again) return
  posted = px
  host.post({ type: 'dictationHeight', px })
}
new ResizeObserver(() => postHeight()).observe(root)

host.post({ type: 'dictationReady' })
