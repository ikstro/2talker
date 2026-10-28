// Dictate's badge by the pointer. The main process says when to start, stop
// or throw away; the badge records, shows the time, the level and the last
// words the engine heard (a phrase is recognized while it is spoken), and then
// hands over the text (to be typed) or finishes the note in the engine.

import type { DictationMode, ToView, TutorHost } from '../protocol'
import { el } from './dom'
import { caps } from './keycaps'
import { ChunkRecorder, micTrouble, PhraseRecorder, StreamRecorder, type StreamStatus } from './recorder'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

const host = window.tutorHost
const root = document.getElementById('badge')!
const TITLES: Record<DictationMode, string> = { type: 'Dictate', english: 'Dictate in English', note: 'Note' }

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
let heard: HTMLElement | undefined
let dot: HTMLElement | undefined

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function show(kind: string, ...children: (Node | string)[]): void {
  root.className = `badge ${kind}`
  root.replaceChildren(...children)
}

/** The last words the engine heard, in place of the keys' hint; behind: the voice is ahead of the engine. */
function onStatus(status: StreamStatus): void {
  if (!heard || !dot) return
  const model = status.model
  const fetching = model?.state === 'downloading'
  const words = status.heard.length > 44 ? `…${status.heard.slice(-44)}` : status.heard
  if (fetching) heard.replaceChildren(`Getting the speech model ${Math.round((model.progress ?? 0) * 100)}%`)
  else if (words) heard.replaceChildren(words)
  heard.classList.toggle('words', fetching || !!words)
  dot.classList.toggle('behind', status.pending > BEHIND)
  dot.title = status.pending > BEHIND ? 'catching up' : ''
}

function recording(key: string): void {
  const time = el('span', { class: 'time' }, '0:00')
  const bars = Array.from({ length: 5 }, () => el('i'))
  dot = el('span', { class: 'dot' })
  heard = el('div', { class: 'hint' }, key ? caps(key) : '', el('span', {}, mode === 'note' ? 'save' : 'type it'), caps('Escape'), el('span', {}, 'cancel'))
  show('rec', el('div', { class: 'line' }, dot, el('span', { class: 'what' }, TITLES[mode]), time, el('span', { class: 'meter' }, ...bars)), heard)
  clearInterval(timer)
  timer = window.setInterval(() => {
    if (!recorder) return
    time.textContent = clock(recorder.seconds)
    const level = recorder.level()
    bars.forEach((bar, i) => bar.classList.toggle('on', level > (i + 0.5) / bars.length))
  }, 80)
}

async function start(next: DictationMode, key: string, session?: string, expected: string[] = []): Promise<void> {
  mode = next
  dropped = false
  recorder =
    mode === 'note'
      ? new ChunkRecorder(host.call, { source: 'note', slice: 2000 })
      : session
        ? new StreamRecorder(host.call, session, expected, onStatus)
        : new PhraseRecorder()
  recording(key)
  try {
    starting = recorder.start()
    await starting
  } catch (error) {
    recorder = undefined
    clearInterval(timer)
    host.post({ type: 'dictationFailed', message: micTrouble(error) })
  }
}

async function stop(): Promise<void> {
  await starting.catch(() => undefined)
  clearInterval(timer)
  const r = recorder
  recorder = undefined
  if (!r) return
  const behind = dot?.classList.contains('behind')
  show(
    'busy',
    el('div', { class: 'line' }, el('span', { class: 'spin' }), el('span', { class: 'what' }, mode === 'note' ? 'Saving the note…' : behind ? 'Catching up…' : 'Typing…')),
    ...(mode === 'note' ? [] : [el('div', { class: 'hint' }, caps('Escape'), el('span', {}, 'cancel'))]),
  )
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
  clearInterval(timer)
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
    if (message.command === 'start') void start(message.mode, message.key, message.session, message.expected)
    else if (message.command === 'stop') void stop()
    else void cancel()
  } else if (message.type === 'dictationDone') {
    show('done', el('div', { class: 'line' }, el('span', { class: 'check' }, '✓'), el('span', { class: 'what' }, mode === 'note' ? 'Saved' : 'Typed')), el('div', { class: 'hint name' }, message.text))
  } else if (message.type === 'dictationError') {
    show('error', el('div', { class: 'line' }, el('span', { class: 'what' }, mode === 'note' ? 'The note was not saved' : 'Nothing typed')), el('div', { class: 'hint name' }, message.message))
  }
})

host.post({ type: 'dictationReady' })
