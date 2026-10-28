// Transcribe and Transcripts: a new transcription (a file dropped anywhere in
// the window or picked, or the microphone), the library of every transcript
// (searched by its words), and one transcript: its progress while the engine
// works, then who said what, editable, with the sound under it, export, copy,
// the knowledge base. The library and an unfinished transcript follow the
// engine's work by asking it again every moment and a half; the bar moves in
// place, so its light keeps running.

import type { AppView } from '../protocol'
import { el, icon } from './dom'
import { caps } from './keycaps'
import { ChunkRecorder, micTrouble } from './recorder'
import {
  api,
  clock,
  fault,
  fileName,
  installed,
  length,
  minutesPerHour,
  pickKb,
  problem,
  redrawPage,
  running,
  showFile,
  SpeechError,
  speakersMissing,
  toast,
  type Row,
  type Source,
  type Transcript,
  type Utterance,
} from './speech'
import { aside, btn, linkBtn, post, row, seg } from './ui'

type Hooks = {
  view: () => AppView | undefined
  /** The Transcripts page is the one open. */
  shown: () => boolean
  /** Opens the Transcripts page (on a transcript, when it is set). */
  show: () => void
  /** Opens the Transcribe page (the engine and the speakers are set up there). */
  setup: () => void
}

let hooks: Hooks = { view: () => undefined, shown: () => false, show: () => {}, setup: () => {} }
export const setTranscriptHooks = (h: Hooks) => (hooks = h)

const SOURCES: Record<Source, { label: string; icon: string }> = {
  file: { label: 'file', icon: 'file-media' },
  mic: { label: 'microphone', icon: 'mic' },
  meet: { label: 'Google Meet', icon: 'organization' },
  note: { label: 'note', icon: 'note' },
}
const STAGES: [string, string][] = [
  ['decode', 'Preparing the sound'],
  ['words', 'Recognizing speech'],
  ['speakers', 'Telling speakers apart'],
  ['save', 'Saving'],
]
/** Each stage's share of the bar: engine/jobs.py WEIGHTS. */
const WEIGHTS: Record<string, [number, number]> = { decode: [0, 0.1], words: [0.1, 0.6], speakers: [0.6, 0.95], save: [0.95, 1] }
const FORMATS: [string, string][] = [
  ['docx', 'Word · .docx'],
  ['md', 'Markdown · .md'],
  ['txt', 'Text · .txt'],
  ['srt', 'Subtitles · .srt'],
  ['vtt', 'Subtitles · .vtt'],
  ['json', 'Data · .json'],
]
/** Whisper's codes for the languages a person may name as their own, where it knows them. */
const CODES: Record<string, string> = {
  Russian: 'ru', Ukrainian: 'uk', German: 'de', French: 'fr', Spanish: 'es', Italian: 'it', Polish: 'pl', Portuguese: 'pt',
  Turkish: 'tr', Dutch: 'nl', Czech: 'cs', Japanese: 'ja', Chinese: 'zh', Korean: 'ko', Arabic: 'ar', Persian: 'fa',
  Kazakh: 'kk', Hebrew: 'he', Swedish: 'sv', Greek: 'el', Hungarian: 'hu', Romanian: 'ro', Bulgarian: 'bg', Finnish: 'fi',
  Danish: 'da', Norwegian: 'no', Serbian: 'sr', Croatian: 'hr', Slovak: 'sk', Lithuanian: 'lt', Latvian: 'lv', Estonian: 'et',
}

const tx = {
  rows: undefined as Row[] | undefined,
  query: '',
  /** The transcript open on the page; empty: the library. */
  openId: '',
  row: undefined as Row | undefined,
  transcript: undefined as Transcript | undefined,
  recorder: undefined as ChunkRecorder | undefined,
  language: 'auto',
  speakers: 0,
  /** The delete button was tapped once: it asks. */
  deleting: false,
  /** The export menu is open. */
  exporting: false,
  /** "Transcribe again" was tapped once: it asks. */
  redoing: false,
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function meta(r: { created: string; duration: number; source: Source }, long = false): string {
  const parts = [(long ? DAY : DATE).format(new Date(r.created))]
  if (r.duration) parts.push(length(r.duration))
  parts.push(SOURCES[r.source]?.label ?? r.source)
  return parts.join(' · ')
}

// ---------------------------------------------------------------- new

const languages = (v: AppView): [string, string][] => {
  const own = CODES[v.settings.native]
  return [['auto', 'Auto'], ['en', 'English'], ...(own ? [[own, v.settings.native] as [string, string]] : [])]
}

/** Files to the engine, read where they are; one opens as it is transcribed, several wait in the library. */
export async function transcribeFiles(files: File[]): Promise<void> {
  const ids: string[] = []
  for (const file of files) {
    const path = window.tutorHost.pathOf(file)
    if (!path) continue
    try {
      ids.push((await api<{ id: string }>('POST', '/transcripts', { path, language: tx.language === 'auto' ? null : tx.language, speakers: tx.speakers || null })).id)
    } catch (error) {
      toast(`${file.name}: ${problem(error)}`, undefined, true)
    }
  }
  if (ids.length === 1) openTranscript(ids[0] as string)
  else if (ids.length > 1) {
    toast(`${ids.length} files are waiting their turn`)
    openTranscript('')
  }
}

const picker = el('input', {
  type: 'file',
  accept: 'audio/*,video/*,.mkv,.m4a,.opus,.flac',
  multiple: true,
  hidden: true,
  onchange: (event: Event) => {
    const input = event.target as HTMLInputElement
    void transcribeFiles([...(input.files ?? [])]).finally(() => (input.value = ''))
  },
})
document.body.append(picker)

/** Transcribe's own rows: the drop zone, the options, the microphone. */
export function newRows(v: AppView): HTMLElement[] {
  const zone = el(
    'div',
    { class: 'zone', role: 'button', tabindex: 0, onclick: () => picker.click(), onkeydown: (e: Event) => (e as KeyboardEvent).key === 'Enter' && picker.click() },
    icon('cloud-upload'),
    el('div', { class: 'zt' }, el('b', {}, 'Drop a video or audio file'), el('small', {}, `here or anywhere in the window · mp4, mov, mkv, webm, mp3, m4a, wav… · read where it is, never copied · an hour takes ≈${minutesPerHour(v) >= 60 ? 'an hour' : `${minutesPerHour(v)} min`} here`)),
    btn('Pick a file…', event => (event.stopPropagation(), picker.click())),
  )
  return [
    zone,
    row('Language', ['Auto: heard from the first seconds'], seg(tx.language, languages(v), language => (tx.language = language))),
    row(
      'Speakers',
      ['how many talk · Auto finds out'],
      seg(tx.speakers, [[0, 'Auto'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6']], speakers => (tx.speakers = speakers), true),
    ),
    micRow(),
  ]
}

function micRow(): HTMLElement {
  const r = tx.recorder
  if (!r) return row('Record from the microphone', ['a talk, a lecture, people in the room · the text comes after Stop'], btn([el('i', { class: 'dot' }), 'Record'], () => void startMic(), 'rec'))
  return el(
    'div',
    { class: 'row live' },
    el('div', { class: 'l' }, el('span', { class: 'livehead' }, el('i', { class: 'dot pulse' }), 'Recording', el('span', { class: 'mtime' }, clock(r.seconds))), el('span', { class: 'level' }, el('i'))),
    el('span', { class: 'kchg' }, linkBtn('Cancel', () => void cancelMic()), btn('Stop and transcribe', () => void stopMic(), 'primary')),
  )
}

// The time and the level move on their own, whatever the page was drawn from.
window.setInterval(() => {
  const r = tx.recorder
  if (!r) return
  for (const t of document.querySelectorAll('.mtime')) t.textContent = clock(r.seconds)
  for (const l of document.querySelectorAll<HTMLElement>('.level i')) l.style.width = `${Math.round(r.level() * 100)}%`
}, 100)

async function startMic(): Promise<void> {
  const r = new ChunkRecorder(window.tutorHost.call, { source: 'mic', slice: 10_000, language: tx.language === 'auto' ? undefined : tx.language, speakers: tx.speakers || undefined })
  try {
    await r.start()
    tx.recorder = r
  } catch (error) {
    toast(micTrouble(error), undefined, true)
  }
  redrawPage()
}

async function stopMic(): Promise<void> {
  const r = tx.recorder
  tx.recorder = undefined
  redrawPage()
  if (!r) return
  try {
    const id = await r.finish()
    if (r.lost) toast('A piece of the recording did not reach the engine', undefined, true)
    openTranscript(id)
  } catch (error) {
    fault(error)
  }
}

async function cancelMic(): Promise<void> {
  const r = tx.recorder
  tx.recorder = undefined
  redrawPage()
  await r?.cancel()
}

// Files dropped anywhere in the window are transcribed with Transcribe's options.
const drop = el('div', { class: 'drop' }, el('div', {}, icon('cloud-upload'), el('b', {}, 'Drop to transcribe')))
document.body.append(drop)
let dragDepth = 0
const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files')
window.addEventListener('dragenter', event => {
  if (!carriesFiles(event)) return
  dragDepth++
  drop.classList.add('on')
})
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) drop.classList.remove('on')
})
window.addEventListener('dragover', event => event.preventDefault())
window.addEventListener('drop', event => {
  event.preventDefault()
  dragDepth = 0
  drop.classList.remove('on')
  const files = [...(event.dataTransfer?.files ?? [])]
  if (!files.length) return
  const v = hooks.view()
  // Without the engine the files have nowhere to go: Transcribe offers it.
  if (!v || !running(v)) return hooks.setup()
  void transcribeFiles(files)
})

// ---------------------------------------------------------------- the library

let searchTimer: number | undefined

async function loadRows(): Promise<void> {
  try {
    const rows = await api<Row[]>('GET', `/transcripts?q=${encodeURIComponent(tx.query)}`)
    const changed = JSON.stringify(rows) !== JSON.stringify(tx.rows)
    tx.rows = rows
    if (changed && hooks.shown() && !tx.openId) redrawPage()
  } catch {
    // the engine is away; the page says so from the view
  }
}

/** The page's caption under its title. */
export function transcriptsCap(): string {
  const n = tx.rows?.length
  if (n === undefined || tx.query) return 'searched by their words'
  return n ? `${n} · searched by their words` : 'none yet'
}

export function transcriptsBody(v: AppView): HTMLElement[] {
  if (!installed(v)) return [row('Transcripts need the speech engine', ['it downloads once, on the Transcribe page'], linkBtn('Transcribe…', () => hooks.setup()))]
  if (!running(v)) return [row('The speech engine is starting…', ['the transcripts show once it runs'], null)]
  return tx.openId ? transcriptPage(v) : libraryPage(v)
}

function libraryPage(v: AppView): HTMLElement[] {
  const kb = v.speech.health?.kbDir
  return [
    el(
      'div',
      { class: 'tools' },
      el(
        'label',
        { class: 'search' },
        icon('search'),
        el('input', {
          type: 'search',
          placeholder: 'Search every transcript',
          value: tx.query,
          oninput: (event: Event) => {
            tx.query = (event.target as HTMLInputElement).value
            window.clearTimeout(searchTimer)
            searchTimer = window.setTimeout(() => void loadRows(), 200)
          },
        }),
      ),
      btn([icon('add'), 'New'], () => hooks.setup(), '', 'A new transcription'),
    ),
    kb === '' ? aside('book', 'Notes need a knowledge base folder.', ' ', linkBtn('Choose…', () => void pickKb())) : null,
    speakersMissing(v, () => hooks.setup()),
    list(v),
  ].filter((n): n is HTMLElement => n !== null)
}

function list(v: AppView): HTMLElement {
  const rows = tx.rows
  if (!rows) return el('ul', { class: 'tl' }, el('li', { class: 'empty' }, 'Opening the library…'))
  if (!rows.length) {
    if (tx.query) return el('ul', { class: 'tl' }, el('li', { class: 'empty' }, 'Nothing found.'))
    const tip = (glyph: string, ...text: (Node | string)[]) => el('li', {}, icon(glyph), el('span', {}, ...text))
    return el(
      'div',
      { class: 'tempty' },
      el('b', {}, 'Transcripts will be here'),
      el(
        'ul',
        {},
        tip('cloud-upload', 'Drop a video or audio file into this window'),
        tip('mic', 'Record from the microphone on the Transcribe page'),
        tip('note', 'Dictate a note: ', caps(v.settings.noteKey), ' in any program'),
        tip('organization', 'Record a Google Meet call with the Chrome extension'),
      ),
    )
  }
  return el(
    'ul',
    { class: 'tl' },
    ...rows.map(r =>
      el(
        'li',
        {},
        el(
          'button',
          { class: 'ti', onclick: () => openTranscript(r.id) },
          el('span', { class: 'src' }, icon(SOURCES[r.source]?.icon ?? 'file')),
          el('span', { class: 'tm' }, el('b', {}, r.title), el('small', {}, meta(r)), r.snippet ? snippet(r.snippet) : null),
          statusChip(r),
        ),
      ),
    ),
  )
}

/** The search marks the found words with [ ]; they become marks. */
function snippet(text: string): HTMLElement {
  const out = el('span', { class: 'snip' })
  for (const part of text.split(/(\[[^\]]*\])/)) {
    if (part.startsWith('[') && part.endsWith(']')) out.append(el('mark', {}, part.slice(1, -1)))
    else if (part) out.append(part)
  }
  return out
}

function statusChip(r: Row): HTMLElement | null {
  if (r.status === 'done') return null
  if (r.status === 'failed') return el('span', { class: 'chip bad' }, 'failed')
  if (r.status === 'recording') return el('span', { class: 'chip rec' }, el('i', { class: 'dot pulse' }), 'recording')
  if (r.status === 'queued') return el('span', { class: 'chip off' }, 'waiting')
  return el('span', { class: 'chip lit' }, `${Math.round(r.progress * 100)}%`)
}

// ---------------------------------------------------------------- a transcript

/** Opens a transcript on the Transcripts page; an empty id, the library. */
export function openTranscript(id: string): void {
  if (id !== tx.openId) stopPlayer()
  tx.openId = id
  tx.deleting = tx.exporting = tx.redoing = false
  if (id && tx.row?.id !== id) {
    tx.row = undefined
    tx.transcript = undefined
  }
  if (id) void loadTranscript()
  else void loadRows()
  if (hooks.shown()) redrawPage()
  else hooks.show()
}

/** Back from a transcript to the library; false when the library is what shows. */
export function backToList(): boolean {
  if (!tx.openId) return false
  openTranscript('')
  return true
}

/** The page closed: the sound stops. */
export function leaveTranscripts(): void {
  stopPlayer()
}

const busy = (status?: string) => status === 'queued' || status === 'working'

async function loadTranscript(): Promise<void> {
  const id = tx.openId
  try {
    const r = await api<{ row: Row; transcript: Transcript | null }>('GET', `/transcripts/${id}`)
    if (id !== tx.openId) return
    const before = tx.row?.id === id ? tx.row : undefined
    tx.row = r.row
    if (r.transcript || r.row.status !== 'done') tx.transcript = r.transcript ?? undefined
    pace.see(r.row)
    if (!hooks.shown()) return
    if (r.row.status === 'done' && before?.status === 'done') return
    // Still on its way: only the card moves, the page stays as it is.
    const card = document.querySelector<HTMLElement>('.progress')
    if (card && busy(before?.status) && busy(r.row.status)) return updateProgress(card, r.row)
    redrawPage()
  } catch (error) {
    if (error instanceof SpeechError && error.status === 404) openTranscript('')
  }
}

function transcriptPage(v: AppView): HTMLElement[] {
  const r = tx.row
  if (!r || r.id !== tx.openId) return [el('p', { class: 'opening' }, 'Opening…')]
  const t = tx.transcript
  const title = el('h2', {
    class: 'ttitle',
    contenteditable: t ? 'plaintext-only' : false,
    spellcheck: 'false',
    title: t ? 'Rename' : undefined,
    onkeydown: (event: Event) => {
      const e = event as KeyboardEvent
      if (e.key === 'Enter') (e.preventDefault(), (e.target as HTMLElement).blur())
      if (e.key === 'Escape') (e.preventDefault(), ((e.target as HTMLElement).textContent = t?.title ?? r.title), (e.target as HTMLElement).blur())
    },
    onblur: (event: Event) => {
      const node = event.target as HTMLElement
      const text = node.textContent?.trim() ?? ''
      if (t && text && text !== t.title) void patch({ title: text }).then(() => void loadRows())
      else node.textContent = t?.title ?? r.title
    },
  })
  title.textContent = t?.title ?? r.title
  const head = el('div', { class: 'thead' }, title, el('small', { class: 'tmeta' }, meta(t ?? r, true)))
  if (r.status !== 'done' || !t) {
    stopPlayer()
    return [head, progressCard(r)]
  }
  return [head, actions(t), ...notices(v, r, t), speakersStrip(t), utterances(t), player(v, t)].filter((n): n is HTMLElement => n !== null)
}

function progressCard(r: Row): HTMLElement {
  if (r.status === 'failed') {
    return el(
      'div',
      { class: 'card bad' },
      el('b', {}, 'Could not transcribe it'),
      el('small', {}, r.error),
      el(
        'div',
        { class: 'cardbtns' },
        btn('Try again', async () => {
          try {
            await api('POST', `/transcripts/${r.id}/retry`)
            void loadTranscript()
          } catch (error) {
            fault(error)
          }
        }),
        linkBtn('Delete', () => void remove(r.id)),
      ),
    )
  }
  if (r.status === 'recording') return el('div', { class: 'card' }, el('b', {}, el('i', { class: 'dot pulse' }), ' Recording'), el('small', {}, 'The text comes once the recording stops.'))
  const card = el(
    'div',
    { class: 'card progress' },
    el('b', { class: 'plead' }),
    el('span', { class: 'track' }, el('i')),
    el('small', { class: 'pstat' }),
    el('ol', { class: 'stages' }, ...STAGES.map(([, label]) => el('li', {}, label))),
    el('small', { class: 'pnote' }, 'The window can be closed: it goes on in the background.'),
  )
  updateProgress(card, r)
  return card
}

function updateProgress(card: HTMLElement, r: Row): void {
  const at = STAGES.findIndex(s => s[0] === r.stage)
  const lead = card.querySelector('.plead')
  if (lead) lead.textContent = r.status === 'queued' ? 'Waiting its turn' : `${STAGES[at]?.[1] ?? 'Starting'}…`
  const track = card.querySelector<HTMLElement>('.track')
  track?.classList.toggle('live', r.status === 'working')
  const fill = track?.firstElementChild as HTMLElement | null
  if (fill) fill.style.width = `${(r.progress * 100).toFixed(1)}%`
  const line = card.querySelector('.pstat')
  if (line) line.textContent = progressLine(r)
  card.querySelectorAll('.stages li').forEach((li, i) => (li.className = i < at ? 'done' : i === at ? 'now' : ''))
}

/** "23 of 64 min · about 2 min left", "40%", or what it waits for. */
function progressLine(r: Row): string {
  if (r.status === 'queued') return 'Starts once the one before it is done.'
  const [a, b] = WEIGHTS[r.stage] ?? [0, 1]
  const part = Math.min(1, Math.max(0, (r.progress - a) / (b - a)))
  const parts: string[] = []
  if (r.stage === 'words' && part === 0) parts.push('loading the model, finding speech')
  else if (r.stage === 'words' && r.duration && r.source !== 'meet') parts.push(position(part * r.duration, r.duration))
  else if (part > 0) parts.push(`${Math.round(part * 100)}%`)
  // Not said while a stage stands still (a model loading): any number then would be a guess.
  const left = part > 0 ? pace.left(r) : ''
  if (left) parts.push(left)
  return parts.join(' · ')
}

function position(at: number, total: number): string {
  return total >= 120 ? `${Math.floor(at / 60)} of ${Math.round(total / 60)} min` : `${clock(at)} of ${clock(total)}`
}

/** The bar's recent positions, to tell how fast it goes now (stages differ in speed). */
const pace = {
  id: '',
  seen: [] as [number, number][],
  see(r: Row): void {
    const now = Date.now()
    if (this.id !== r.id) (this.id = r.id), (this.seen = [])
    this.seen = this.seen.filter(([t, p]) => now - t < 30_000 && p <= r.progress)
    this.seen.push([now, r.progress])
  },
  left(r: Row): string {
    const first = this.seen[0]
    if (this.id !== r.id || !first) return ''
    const spent = (Date.now() - first[0]) / 1000
    const done = r.progress - first[1]
    if (spent < 8 || done < 0.01) return ''
    const left = ((1 - r.progress) * spent) / done
    return left < 60 ? 'under a minute left' : `about ${Math.round(left / 60)} min left`
  },
}

async function patch(changes: unknown): Promise<void> {
  try {
    const t = await api<Transcript>('PATCH', `/transcripts/${tx.openId}`, changes)
    const recount = t.utterances.length !== tx.transcript?.utterances.length
    tx.transcript = t
    if (recount) redrawPage()
  } catch (error) {
    fault(error)
  }
}

function actions(t: Transcript): HTMLElement {
  const copy = btn([icon('copy'), 'Copy'], async () => {
    try {
      await window.tutorHost.call({ call: 'copy', text: await api<string>('GET', `/transcripts/${t.id}/text?format=txt`) })
      toast('The text is copied')
    } catch (error) {
      fault(error)
    }
  })
  const menu = tx.exporting
    ? el(
        'div',
        { class: 'menu', role: 'menu' },
        ...FORMATS.map(([format, label]) =>
          el(
            'button',
            {
              class: 'mi',
              role: 'menuitem',
              onclick: async () => {
                tx.exporting = false
                redrawPage()
                try {
                  const path = (await window.tutorHost.call({ call: 'exportTranscript', id: t.id, format, name: t.title })) as string | null
                  if (path) toast(`Saved: ${fileName(path)}`, showFile(path))
                } catch (error) {
                  fault(error)
                }
              },
            },
            label,
          ),
        ),
      )
    : null
  const exporter = el(
    'span',
    { class: 'menuwrap' },
    btn([icon('desktop-download'), 'Export', icon('chevron-down')], event => {
      event.stopPropagation()
      tx.exporting = !tx.exporting
      redrawPage()
    }),
    menu,
  )
  const toKb =
    t.source !== 'note'
      ? btn([icon('book'), 'To knowledge base'], async () => {
          try {
            const { path } = await api<{ path: string }>('POST', `/transcripts/${t.id}/to-kb`)
            toast(`In the knowledge base: ${fileName(path)}`, showFile(path))
          } catch (error) {
            const choose = error instanceof SpeechError && error.status === 409
            toast(problem(error), choose ? { label: 'Choose a folder', run: () => void pickKb() } : undefined, true)
          }
        })
      : null
  const del = tx.deleting
    ? el(
        'span',
        { class: 'confirm' },
        el('small', {}, 'Delete for good?'),
        btn('Delete', () => void remove(t.id), 'danger'),
        linkBtn('Keep', () => ((tx.deleting = false), redrawPage())),
      )
    : el('button', { class: 'ib del', title: 'Delete', 'aria-label': 'Delete', onclick: () => ((tx.deleting = true), redrawPage()) }, icon('trash'))
  return el('div', { class: 'tools tacts' }, copy, exporter, toKb, el('span', { class: 'gap' }), del)
}

// An open export menu closes on any click elsewhere.
window.addEventListener('click', event => {
  if (!tx.exporting || (event.target as Element).closest?.('.menuwrap')) return
  tx.exporting = false
  redrawPage()
})

async function remove(id: string): Promise<void> {
  try {
    await api('DELETE', `/transcripts/${id}`)
    toast('Deleted')
    openTranscript('')
  } catch (error) {
    fault(error)
  }
}

function notices(v: AppView, r: Row, t: Transcript): HTMLElement[] {
  const out: HTMLElement[] = []
  const note = t.note
  if (note) {
    out.push(
      aside('book', 'In the knowledge base: ', el('b', {}, fileName(note)), ' ', linkBtn('Open', () => post({ type: 'openPath', path: note })), linkBtn('Show in folder', () => post({ type: 'showInFolder', path: note }))),
    )
  }
  if (t.noteError) out.push(aside('info', t.noteError, ' ', linkBtn('Choose a folder', () => void pickKb())))
  if (r.error) out.push(aside('warning', r.error))
  const speakers = speakersNotice(v, t)
  if (speakers) out.push(speakers)
  return out
}

/** Can this transcript be split by speaker now, and how: from its words, or only by recognizing it anew. */
function splitWay(t: Transcript): 'words' | 'redo' | null {
  if (t.source === 'note' || t.speakersStatus === 'ok') return null
  if (t.hasWords) return 'words'
  return t.source === 'file' || t.source === 'mic' ? 'redo' : null
}

/** Speakers missing from a transcript: what to do about it, right where it shows. */
function speakersNotice(v: AppView, t: Transcript): HTMLElement | null {
  if (t.source === 'note' || t.speakersStatus === 'ok' || t.speakersStatus === 'single') return null
  const why = t.speakersStatus === 'failed' ? 'Speakers could not be told apart; the text is one stream.' : 'Speakers are not told apart: it was made without a Hugging Face key.'
  const missing = speakersMissing(v, () => hooks.setup())
  if (missing) return aside('person', why, ' ', linkBtn('Set up speakers', () => hooks.setup()))
  const way = splitWay(t)
  if (!way) return aside('person', `${why} This meeting can no longer be split: its words were not kept.`)
  const run = () => void splitSpeakers(t.id)
  if (way === 'words') return aside('person', `${why} The text is not recognized again; edits stay.`, ' ', linkBtn('Split by speaker', run))
  // Made before the words' times were kept: only a full new pass can split it.
  const minutes = Math.max(1, Math.round((t.duration / 3600) * minutesPerHour(v)))
  if (tx.redoing) {
    return aside(
      'person',
      t.edited ? 'Edits to the text will be lost. Go on?' : 'Go on?',
      ' ',
      linkBtn('Transcribe again', run),
      linkBtn('Not now', () => ((tx.redoing = false), redrawPage())),
    )
  }
  return aside('person', `${why} It can be transcribed again, with speakers: about ${minutes} min.`, ' ', linkBtn('Transcribe again', () => ((tx.redoing = true), redrawPage())))
}

async function splitSpeakers(id: string): Promise<void> {
  tx.redoing = false
  try {
    await api('POST', `/transcripts/${id}/speakers`, {})
    if (tx.openId === id && tx.row) {
      tx.row = { ...tx.row, status: 'queued', progress: 0, stage: '' }
      redrawPage()
    }
  } catch (error) {
    fault(error)
  }
}

function speakerClass(t: Transcript, key: string): string {
  if (key === 'me') return 'sp-me'
  return `sp-${(Object.keys(t.speakers).filter(k => k !== 'me').indexOf(key) % 6) + 1}`
}

/** The speakers as chips, each renamed in place; their names change in the text at once. */
function speakersStrip(t: Transcript): HTMLElement | null {
  const keys = Object.keys(t.speakers)
  if (keys.length < 2) return null
  const strip = el('div', { class: 'spk' })
  for (const key of keys) {
    const name = t.speakers[key]?.name ?? key
    const chipNode = el('button', { class: `chip sp ${speakerClass(t, key)}`, title: 'Rename' }, el('i', { class: 'sw' }), name)
    chipNode.addEventListener('click', () => {
      const input = el('input', { type: 'text', class: 'field', value: name, 'aria-label': 'Speaker’s name' })
      let done = false
      const finish = (keep: boolean) => {
        if (done) return
        done = true
        const next = input.value.trim()
        const s = t.speakers[key]
        if (keep && next && s && next !== s.name) {
          s.name = next
          void patch({ speakers: { [key]: next } })
          for (const who of document.querySelectorAll<HTMLElement>(`.who[data-speaker="${key}"]`)) who.textContent = next
          chipNode.lastChild!.textContent = next
        }
        input.replaceWith(chipNode)
      }
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') finish(true)
        if (event.key === 'Escape') (event.preventDefault(), finish(false))
      })
      input.addEventListener('blur', () => finish(true))
      chipNode.replaceWith(input)
      input.select()
    })
    strip.append(chipNode)
  }
  strip.append(el('small', {}, 'tap a name to rename'))
  return strip
}

function speakerMenu(t: Transcript, i: number, label: HTMLElement): void {
  document.querySelector('.whomenu')?.remove()
  const menu = el(
    'div',
    { class: 'menu whomenu', role: 'menu' },
    ...Object.entries(t.speakers).map(([key, s]) =>
      el(
        'button',
        {
          class: `mi ${speakerClass(t, key)}`,
          role: 'menuitem',
          onclick: () => {
            menu.remove()
            const u = t.utterances[i]
            if (!u || u.speaker === key) return
            u.speaker = key
            void patch({ utterances: { [i]: { speaker: key } } }).then(redrawPage)
          },
        },
        el('i', { class: 'sw' }),
        s.name,
      ),
    ),
  )
  label.after(menu)
  window.setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }))
}

function utterances(t: Transcript): HTMLElement {
  const many = Object.keys(t.speakers).length > 1
  const list = el('div', { class: 'utts' })
  t.utterances.forEach((u: Utterance, i: number) => {
    const first = i === 0 || t.utterances[i - 1]?.speaker !== u.speaker
    const text = el('div', {
      class: 'ut',
      contenteditable: 'plaintext-only',
      spellcheck: 'false',
      onkeydown: (event: Event) => {
        const e = event as KeyboardEvent
        const node = e.target as HTMLElement
        if (e.key === 'Enter' && !e.shiftKey) (e.preventDefault(), node.blur())
        if (e.key === 'Escape') (e.preventDefault(), (node.textContent = t.utterances[i]?.text ?? ''), node.blur())
      },
      onblur: (event: Event) => {
        const value = (event.target as HTMLElement).textContent?.trim() ?? ''
        const now = t.utterances[i]
        if (now && value !== now.text) {
          now.text = value
          void patch({ utterances: { [i]: { text: value } } })
        }
      },
    })
    text.textContent = u.text
    const who = many && first ? el('button', { class: 'who', 'data-speaker': u.speaker, title: 'Another speaker' }, t.speakers[u.speaker]?.name ?? u.speaker) : null
    who?.addEventListener('click', event => (event.stopPropagation(), speakerMenu(t, i, who)))
    list.append(
      el(
        'div',
        { class: `utt${first ? ' first' : ''}${who ? ' has-who' : ''}${i === heard ? ' now' : ''} ${speakerClass(t, u.speaker)}`, 'data-i': String(i) },
        el('button', { class: 'at', title: 'Listen from here', onclick: () => seek(u.start) }, clock(u.start)),
        el('div', { class: 'ub' }, who, text),
      ),
    )
  })
  return list
}

// ---------------------------------------------------------------- the sound

/** The sound of the open transcript: one element kept outside the page, so a redraw never stops it. */
let audio: HTMLAudioElement | undefined
let audioId = ''
/** The utterance being heard. */
let heard = -1

function stopPlayer(): void {
  audio?.pause()
  audio?.removeAttribute('src')
  audio = undefined
  audioId = ''
  heard = -1
}

function soundOf(v: AppView, t: Transcript): HTMLAudioElement {
  if (audio && audioId === t.id) return audio
  stopPlayer()
  const a = new Audio(`http://127.0.0.1:${v.speech.port}/transcripts/${encodeURIComponent(t.id)}/audio`)
  a.preload = 'metadata'
  const sync = () => {
    for (const p of document.querySelectorAll<HTMLElement>('.player')) {
      const playing = !a.paused
      p.classList.toggle('playing', playing)
      p.querySelector('.pp')?.replaceChildren(icon(playing ? 'debug-pause' : 'play'))
      const time = p.querySelector('.ptime')
      if (time) time.textContent = `${clock(a.currentTime)} / ${clock(t.duration)}`
      const range = p.querySelector<HTMLInputElement>('.scrub')
      if (range && document.activeElement !== range) range.value = String(Math.round(a.currentTime * 10))
    }
    mark(t, a.currentTime, !a.paused)
  }
  a.addEventListener('play', sync)
  a.addEventListener('pause', sync)
  a.addEventListener('timeupdate', sync)
  audio = a
  audioId = t.id
  return a
}

function seek(at: number): void {
  if (!audio) return
  audio.currentTime = Math.max(0, at - 0.3)
  void audio.play()
}

const SPEEDS = [1, 1.25, 1.5, 2]

function player(v: AppView, t: Transcript): HTMLElement {
  const a = soundOf(v, t)
  const playing = !a.paused
  const range = el('input', { type: 'range', class: 'scrub', min: 0, max: Math.round(t.duration * 10), value: Math.round(a.currentTime * 10), 'aria-label': 'Position' })
  range.addEventListener('input', () => (a.currentTime = Number(range.value) / 10))
  const speed = el('button', { class: 'speed', title: 'Speed' }, `${a.playbackRate}×`)
  speed.addEventListener('click', () => {
    const next = SPEEDS[(SPEEDS.indexOf(a.playbackRate) + 1) % SPEEDS.length] ?? 1
    a.playbackRate = next
    speed.textContent = `${next}×`
  })
  return el(
    'div',
    { class: playing ? 'player playing' : 'player' },
    el('button', { class: 'pp', title: 'Play or pause · Space', 'aria-label': 'Play or pause', onclick: () => (a.paused ? void a.play() : a.pause()) }, icon(playing ? 'debug-pause' : 'play')),
    el('span', { class: 'ptime' }, `${clock(a.currentTime)} / ${clock(t.duration)}`),
    range,
    speed,
  )
}

/** The utterance being heard gets a mark, and comes into view while playing. */
function mark(t: Transcript, at: number, follow: boolean): void {
  let lo = 0
  let hi = t.utterances.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if ((t.utterances[mid]?.start ?? 0) <= at + 0.3) (found = mid), (lo = mid + 1)
    else hi = mid - 1
  }
  if (found === heard) return
  heard = found
  document.querySelector('.utt.now')?.classList.remove('now')
  const node = document.querySelector<HTMLElement>(`.utt[data-i="${found}"]`)
  node?.classList.add('now')
  if (follow && node && !node.contains(document.activeElement)) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

// Space plays and pauses while a transcript is open and nothing is being typed.
window.addEventListener('keydown', event => {
  if (event.code !== 'Space' || !audio || !hooks.shown() || !tx.openId) return
  const target = event.target as HTMLElement
  if (target.isContentEditable || target.matches('input, textarea, select') || target.classList.contains('recording')) return
  event.preventDefault()
  if (audio.paused) void audio.play()
  else audio.pause()
})

// ---------------------------------------------------------------- following the engine

// The library and an unfinished transcript follow the engine's work.
window.setInterval(() => {
  const v = hooks.view()
  if (!v || !running(v) || !hooks.shown()) return
  if (!tx.openId) void loadRows()
  else if (tx.row && tx.row.status !== 'done') void loadTranscript()
}, 1500)

/** The page opened: the library is asked for at once. */
export function enterTranscripts(): void {
  if (tx.openId) void loadTranscript()
  else void loadRows()
}
