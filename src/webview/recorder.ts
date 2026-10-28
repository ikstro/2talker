// The microphone, for Dictate's badge and Transcribe's recordings. A phrase
// to type is kept whole and handed over at the end (`PhraseRecorder`); a note
// or a recording goes to the speech engine while it is made, a chunk every
// few seconds (`ChunkRecorder`), so a closed window loses at most the last one.

import type { HostCall, SpeechResult } from '../protocol'

export type Call = (request: HostCall) => Promise<unknown>

/** The browser's own echo and noise handling suits speech close to the microphone; a room recording keeps everything. */
async function microphone(close: boolean): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: close, noiseSuppression: close, autoGainControl: true, channelCount: 1 } })
}

class Meter {
  private context: AudioContext
  private analyser: AnalyserNode
  private samples: Float32Array<ArrayBuffer>

  constructor(stream: MediaStream) {
    this.context = new AudioContext()
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 1024
    this.samples = new Float32Array(this.analyser.fftSize)
    this.context.createMediaStreamSource(stream).connect(this.analyser)
  }

  /** How loud it is now, 0…1. */
  level(): number {
    this.analyser.getFloatTimeDomainData(this.samples)
    let sum = 0
    for (const v of this.samples) sum += v * v
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4)
  }

  close(): void {
    void this.context.close()
  }
}

function stopped(recorder: MediaRecorder | undefined): Promise<void> {
  if (!recorder || recorder.state === 'inactive') return Promise.resolve()
  return new Promise(resolve => {
    recorder.onstop = () => resolve()
    recorder.stop()
  })
}

/** A short phrase, recorded whole. */
export class PhraseRecorder {
  startedAt = 0
  private stream: MediaStream | undefined
  private recorder: MediaRecorder | undefined
  private meter: Meter | undefined
  private chunks: Blob[] = []

  async start(): Promise<void> {
    this.stream = await microphone(true)
    this.startedAt = Date.now()
    this.meter = new Meter(this.stream)
    this.recorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48000 })
    this.recorder.ondataavailable = event => event.data.size > 0 && this.chunks.push(event.data)
    this.recorder.start(250)
  }

  level(): number {
    return this.meter?.level() ?? 0
  }

  get seconds(): number {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0
  }

  /** The recording, as webm. */
  async finish(): Promise<Uint8Array> {
    await stopped(this.recorder)
    this.release()
    return new Uint8Array(await new Blob(this.chunks, { type: 'audio/webm' }).arrayBuffer())
  }

  async cancel(): Promise<void> {
    await stopped(this.recorder)
    this.release()
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.meter?.close()
    this.stream = undefined
    this.meter = undefined
  }
}

export type ChunkOptions = {
  source: 'mic' | 'note'
  title?: string
  language?: string
  speakers?: number
  /** Milliseconds per chunk. */
  slice: number
}

const RETRIES = 3

/** A recording the engine receives while it is made. */
export class ChunkRecorder {
  id: string | undefined
  startedAt = 0
  /** Set when a chunk could not be delivered: the recording will be missing a piece. */
  lost = false
  private recorder: MediaRecorder | undefined
  private stream: MediaStream | undefined
  private meter: Meter | undefined
  private seq = 0
  private uploads: Promise<void> = Promise.resolve()

  constructor(
    private readonly call: Call,
    private readonly o: ChunkOptions,
  ) {}

  private speech<T>(method: string, route: string, body?: unknown): Promise<SpeechResult<T>> {
    return this.call({ call: 'speech', method, route, body }) as Promise<SpeechResult<T>>
  }

  /** Asks for the microphone, opens the recording in the engine, starts sending. */
  async start(): Promise<void> {
    this.stream = await microphone(this.o.source === 'note')
    this.startedAt = Date.now()
    const opened = await this.speech<{ id: string }>('POST', '/recordings', {
      source: this.o.source,
      title: this.o.title,
      language: this.o.language,
      speakers: this.o.speakers,
      tracks: { main: { startedAt: this.startedAt } },
    })
    if (!opened.ok) {
      this.release()
      throw new Error(opened.error)
    }
    this.id = opened.data.id
    this.meter = new Meter(this.stream)
    this.recorder = new MediaRecorder(this.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 48000 })
    this.recorder.ondataavailable = event => {
      if (event.data.size > 0) this.upload(event.data)
    }
    this.recorder.start(this.o.slice)
  }

  private upload(blob: Blob): void {
    const seq = this.seq++
    this.uploads = this.uploads.then(async () => {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      for (let attempt = 0; attempt < RETRIES; attempt++) {
        if ((await this.speech('PUT', `/recordings/${this.id}/main/${seq}`, bytes)).ok) return
        await new Promise(resolve => setTimeout(resolve, 600 * (attempt + 1)))
      }
      this.lost = true
    })
  }

  level(): number {
    return this.meter?.level() ?? 0
  }

  get seconds(): number {
    return this.startedAt ? (Date.now() - this.startedAt) / 1000 : 0
  }

  /** Stops, sends what is left, and hands the recording to the engine. Its id. */
  async finish(): Promise<string> {
    await stopped(this.recorder)
    await this.uploads
    this.release()
    const r = await this.speech('POST', `/recordings/${this.id}/finish`, { language: this.o.language, speakers: this.o.speakers })
    if (!r.ok) throw new Error(r.error)
    return this.id!
  }

  async cancel(): Promise<void> {
    await stopped(this.recorder)
    this.release()
    if (this.id) await this.speech('DELETE', `/recordings/${this.id}`)
  }

  private release(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.meter?.close()
    this.stream = undefined
    this.meter = undefined
  }
}

/** What getUserMedia's refusal means, in words. */
export function micTrouble(error: unknown): string {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError') return 'No access to the microphone: allow it in Windows Settings → Privacy → Microphone'
  if (name === 'NotFoundError') return 'No microphone found'
  if (name === 'NotReadableError') return 'Another program holds the microphone'
  return error instanceof Error ? error.message : String(error)
}
