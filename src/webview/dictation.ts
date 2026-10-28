// Dictate's badge by the pointer. The main process says when to start, stop
// or throw away; the badge records, shows the time and the level, and then
// hands over the phrase (to be typed) or finishes the note in the engine.

import type { DictationMode, ToView, TutorHost } from '../protocol'
import { el } from './dom'
import { caps } from './keycaps'
import { ChunkRecorder, micTrouble, PhraseRecorder } from './recorder'

declare global {
  interface Window {
    tutorHost: TutorHost
  }
}

const host = window.tutorHost
const root = document.getElementById('badge')!
const TITLES: Record<DictationMode, string> = { type: 'Dictate', english: 'Dictate in English', note: 'Note' }

type Recorder = PhraseRecorder | ChunkRecorder
let recorder: Recorder | undefined
let mode: DictationMode = 'type'
/** The microphone and the engine are still being asked: a quick stop waits for them. */
let starting: Promise<void> = Promise.resolve()
let timer: number | undefined

function clock(seconds: number): string {
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function show(kind: string, ...children: (Node | string)[]): void {
  root.className = `badge ${kind}`
  root.replaceChildren(...children)
}

function recording(key: string): void {
  const time = el('span', { class: 'time' }, '0:00')
  const bars = Array.from({ length: 5 }, () => el('i'))
  show(
    'rec',
    el('div', { class: 'line' }, el('span', { class: 'dot' }), el('span', { class: 'what' }, TITLES[mode]), time, el('span', { class: 'meter' }, ...bars)),
    el('div', { class: 'hint' }, key ? caps(key) : '', el('span', {}, mode === 'note' ? 'save' : 'type it'), caps('Escape'), el('span', {}, 'cancel')),
  )
  clearInterval(timer)
  timer = window.setInterval(() => {
    if (!recorder) return
    time.textContent = clock(recorder.seconds)
    const level = recorder.level()
    bars.forEach((bar, i) => bar.classList.toggle('on', level > (i + 0.5) / bars.length))
  }, 80)
}

async function start(next: DictationMode, key: string): Promise<void> {
  mode = next
  recorder = mode === 'note' ? new ChunkRecorder(host.call, { source: 'note', slice: 2000 }) : new PhraseRecorder()
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
  show('busy', el('div', { class: 'line' }, el('span', { class: 'spin' }), el('span', { class: 'what' }, mode === 'note' ? 'Saving the note…' : 'Typing…')))
  try {
    if (r instanceof ChunkRecorder) host.post({ type: 'dictationNote', id: await r.finish() })
    else host.post({ type: 'dictationAudio', mode, audio: await r.finish() })
  } catch (error) {
    host.post({ type: 'dictationFailed', message: error instanceof Error ? error.message : String(error) })
  }
}

async function cancel(): Promise<void> {
  await starting.catch(() => undefined)
  clearInterval(timer)
  const r = recorder
  recorder = undefined
  await r?.cancel()
  host.post({ type: 'dictationCancelled' })
}

window.addEventListener('message', event => {
  const message = event.data as ToView
  if (event.source !== window || !message || typeof message.type !== 'string') return
  if (message.type === 'dictation') {
    if (message.command === 'start') void start(message.mode, message.key)
    else if (message.command === 'stop') void stop()
    else void cancel()
  } else if (message.type === 'dictationDone') {
    show('done', el('div', { class: 'line' }, el('span', { class: 'check' }, '✓'), el('span', { class: 'what' }, mode === 'note' ? 'Saved' : 'Typed')), el('div', { class: 'hint name' }, message.text))
  } else if (message.type === 'dictationError') {
    show('error', el('div', { class: 'line' }, el('span', { class: 'what' }, mode === 'note' ? 'The note was not saved' : 'Nothing typed')), el('div', { class: 'hint name' }, message.message))
  }
})

host.post({ type: 'dictationReady' })
