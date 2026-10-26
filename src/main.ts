// 2Talker's main process. It lives in the tray and waits for a text:
//   - Ctrl+C twice in any program: the copied text;
//   - the snip shortcut (Ctrl+Alt+S): Windows' own snipping overlay opens,
//     and the piece of the screen it puts on the clipboard is read with the
//     OCR built into Windows.
// The text is translated offline and shown in the card, a small window by the
// pointer: the text in English on top, read aloud by the natural voice or a
// system one, and its translation under it. Closing the card silences it.
//
// The app window (media/app.html) holds the notebook of saved words, the
// settings and how to use; the tray menu has the quick switches.
//
// %APPDATA%\2Talker\
//   settings.json   see settings.ts
//   words.json      the word notebook (words.ts)
//   voice\          the natural voice, downloaded on request
//   dict\           word dictionaries for languages other than Russian
//   models\         the translator's models, one folder per language pair

import * as fs from 'node:fs'
import * as path from 'node:path'

import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, screen, shell, Tray, type MenuItemConstructorOptions } from 'electron'

import { DoubleCopy } from './clipboard'
import { DictionaryStore } from './dictstore'
import { openStream } from './download'
import { createTranslator, NATIVES } from './engine'
import { defaultNative, findLanguage, langCode, scriptFor, voiceMatches } from './languages'
import { lookup, type Dictionary } from './lemma'
import { NATURAL_PREFIX, NATURAL_VOICES, naturalLabel, systemVoiceName, type NaturalState } from './natural'
import { recognize } from './ocr'
import { paragraphsOf } from './ocrtext'
import { placeNear, resize, type Point } from './placement'
import type { AppView, CardKind, CardState, GlossMissing, HostVoice, ToHost, ToView, TranslationState, ViewConfig } from './protocol'
import { englishHtml, translationHtml } from './render'
import { normalize, TARGET, type Settings } from './settings'
import { Speaker, listHostVoices } from './speech'
import { NaturalSpeaker } from './synth'
import { englishReady, splitText, translateLines } from './translate'
import type { Translator } from './translator'
import { Updater } from './update'
import manifest from './voice-manifest.json'
import { VoiceStore, type VoiceManifest } from './voicestore'
import { ctrlHeld, watchClipboard } from './winclip'
import { ankiTsv, WordStore, wordsText } from './words'

const CARD_WIDTH = 440
const CARD_MIN = 96
const CARD_MAX = 560
/** The offline translator takes a few hundred ms a sentence: a longer text is cut. */
const MAX_TEXT_CHARS = 6000
/** How long after the snip shortcut a picture on the clipboard counts as the snip. */
const SNIP_WAIT_MS = 120_000
/** Programs put a copy on the clipboard in steps; it is read once they are done. */
const SETTLE_MS = 60
const RATES = [0.75, 0.9, 1, 1.15, 1.3]

const userDir = () => app.getPath('userData')
const settingsFile = () => path.join(userDir(), 'settings.json')
/** A file the packaged app keeps outside its archive: the workers run as separate processes. */
const unpacked = (...parts: string[]) => path.join(app.getAppPath(), ...parts).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

let settings: Settings
let tray: Tray | undefined
let card: BrowserWindow | undefined
let cardReady = false
let pinned = false
let shownAt = 0
/** The card on screen; a newer text replaces it. */
let seq = 0
let shown: { id: number; kind: CardKind; state: CardState } | undefined
let last: { id: number; text: string; kind: CardKind; note?: string } | undefined
let snipSince = 0
let stopWatching: (() => void) | undefined
let hostVoices: HostVoice[] | undefined
const copies = new DoubleCopy()
let appWin: BrowserWindow | undefined
let appReady = false
let quitting = false
let snipKeyOk = true
let words: WordStore
let updater: Updater
/** The most common English words, for the card's dotted lines; read once. */
let common: string[] | undefined

// ---------------------------------------------------------------- settings

function systemNative(): string {
  return defaultNative([app.getLocale(), ...app.getPreferredSystemLanguages()], TARGET)
}

/** The app was called tu-talk at first: its settings, translator and voice move over, once. */
function adoptOldFolder(): void {
  const old = path.join(app.getPath('appData'), 'tu-talk')
  if (!fs.existsSync(old)) return
  for (const name of ['settings.json', 'models', 'voice', 'dict']) {
    const from = path.join(old, name)
    const to = path.join(userDir(), name)
    if (!fs.existsSync(from) || fs.existsSync(to)) continue
    try {
      fs.mkdirSync(userDir(), { recursive: true })
      fs.renameSync(from, to)
    } catch (error) {
      console.warn(`2Talker: could not move ${from}`, error)
    }
  }
}

function readSettings(): Settings {
  try {
    return normalize(JSON.parse(fs.readFileSync(settingsFile(), 'utf8')), systemNative())
  } catch {
    return normalize(undefined, systemNative())
  }
}

function saveSettings(patch: Partial<Settings>): void {
  settings = normalize({ ...settings, ...patch }, settings.native)
  try {
    fs.mkdirSync(userDir(), { recursive: true })
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2) + '\n', 'utf8')
  } catch (error) {
    console.warn('2Talker: could not save the settings', error)
  }
  if ('startWithWindows' in patch) applyLoginItem()
  if ('snipKey' in patch) registerSnipKey()
  refreshTray()
  if (shown) postCard()
  postApp()
}

function applyLoginItem(): void {
  // A development run would register electron.exe itself.
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.startWithWindows })
}

function config(): ViewConfig {
  return { voice: settings.voice, rate: settings.rate, wordHint: settings.wordHint, rareWords: settings.rareWords }
}

// ---------------------------------------------------------------- speech and words

let speaker: Speaker
let natural: NaturalSpeaker
let voiceStore: VoiceStore
let dictionaries: DictionaryStore

function setUpSpeech(): void {
  speaker = new Speaker({
    progress: (id, pos, len) => post({ type: 'progress', id, pos, len }),
    done: id => post({ type: 'speakDone', id }),
  })
  voiceStore = new VoiceStore({
    manifest: manifest as VoiceManifest,
    root: path.join(userDir(), 'voice'),
    platform: process.platform,
    arch: process.arch,
    open: url => openStream(url),
    onChange: () => {
      post({ type: 'natural', state: naturalState() })
      refreshTray()
      postApp()
    },
  })
  natural = new NaturalSpeaker(unpacked('dist', 'voice-worker.js'), () => voiceStore.paths, {
    audio: (id, index, samples, words) => post({ type: 'naturalAudio', id, index, samples, words }),
    failed: (id, message) => post({ type: 'naturalFailed', id, message }),
    phonemes: (text, ipa) => {
      if (ipa) post({ type: 'ipa', word: text, ipa })
    },
  })
  dictionaries = new DictionaryStore({
    bundledDir: path.join(app.getAppPath(), 'media', 'dict'),
    cacheDir: path.join(userDir(), 'dict'),
    fetchGz: async url => {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    onReady: () => post({ type: 'dictReady' }),
  })
}

function naturalState(): NaturalState {
  return { ...voiceStore.state, dismissed: settings.naturalDismissed }
}

function stopSpeaking(): void {
  speaker.stop()
  natural.stop()
}

/** The dictionary for the person's language, if it is here. */
function dictionary(): Dictionary | undefined {
  const state = dictionaries.get(langCode(settings.native), false)
  return state.status === 'ready' ? state.dict : undefined
}

function lookupWord(word: string): void {
  // The natural voice's phonemizer says how the word sounds; it answers as `ipa`.
  if (voiceStore.state.status === 'ready') natural.phonemes(word)
  const miss = (missing: GlossMissing) => post({ type: 'gloss', word, missing, saved: words.has(word) })
  const state = dictionaries.get(langCode(settings.native), true)
  if (state.status === 'none') return miss('no-dictionary')
  if (state.status === 'downloading') return miss('downloading')
  if (state.status === 'failed') return miss('download-failed')
  if (state.status === 'off') return miss('download-off')
  const gloss = lookup(state.dict, word)
  const saved = words.has(gloss?.base ?? word)
  post(gloss ? { type: 'gloss', word, gloss, saved } : { type: 'gloss', word, missing: 'not-found', saved })
}

// ---------------------------------------------------------------- the notebook

function saveWord(word: string, sentence: string): void {
  const dict = dictionary()
  const gloss = dict ? lookup(dict, word) : undefined
  words.add({ word, base: gloss?.base ?? word.toLowerCase(), senses: gloss?.entries.flatMap(e => e.senses) ?? [], sentence })
  post({ type: 'saved', word, saved: true })
  postApp()
}

function unsaveWord(word: string): void {
  const dict = dictionary()
  words.removeBase((dict && lookup(dict, word)?.base) ?? word)
  post({ type: 'saved', word, saved: false })
  postApp()
}

async function exportWords(): Promise<void> {
  const { filePath } = await dialog.showSaveDialog(appWin ?? ({} as BrowserWindow), {
    title: 'Save the words for Anki',
    defaultPath: path.join(app.getPath('documents'), '2Talker words.txt'),
    filters: [{ name: 'Text for Anki', extensions: ['txt'] }],
  })
  if (filePath) fs.writeFileSync(filePath, ankiTsv(words.list()) + '\n', 'utf8')
}

// ---------------------------------------------------------------- the card

function createCard(): BrowserWindow {
  const win = new BrowserWindow({
    width: CARD_WIDTH,
    height: 160,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: '2Talker',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f8f8f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.removeMenu()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  // Clicking another window puts the card away, unless it is pinned or has only just opened.
  win.on('blur', () => {
    if (!pinned && Date.now() - shownAt > 400) hideCard()
  })
  void win.loadFile(path.join(app.getAppPath(), 'media', 'card.html'))
  return win
}

function post(message: ToView): void {
  if (card && cardReady && !card.isDestroyed()) card.webContents.send('to-view', message)
}

function commonWords(): string[] {
  if (!common) {
    try {
      common = fs.readFileSync(path.join(app.getAppPath(), 'media', 'common-en.txt'), 'utf8').split(/\r?\n/).filter(Boolean)
    } catch {
      common = []
    }
  }
  return common
}

// ---------------------------------------------------------------- the app window

function appView(): AppView {
  return {
    settings,
    version: app.getVersion(),
    natural: naturalState(),
    hostVoices: hostVoices ?? [],
    languages: NATIVES.map(code => findLanguage(code))
      .filter(l => l !== undefined)
      .map(l => ({ name: l.name, native: l.native })),
    words: words.list(),
    update: updater.status,
    snipKeyOk,
  }
}

function postApp(): void {
  if (appWin && appReady && !appWin.isDestroyed()) appWin.webContents.send('to-view', { type: 'app', view: appView() } satisfies ToView)
}

function createAppWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 640,
    height: 620,
    minWidth: 480,
    minHeight: 400,
    show: false,
    title: '2Talker',
    icon: path.join(app.getAppPath(), 'media', 'icon.png'),
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202020' : '#f8f8f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  win.removeMenu()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  // A run from source shows the page's errors in the terminal.
  if (!app.isPackaged) {
    win.webContents.on('console-message', m => console.warn(`2Talker app window: ${m.message} (${m.sourceId}:${m.lineNumber})`))
    win.webContents.on('did-fail-load', (_event, code, description) => console.warn(`2Talker app window did not load: ${code} ${description}`))
  }
  // Closing hides: 2Talker lives in the tray.
  win.on('close', event => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    appWin = undefined
    appReady = false
  })
  void win.loadFile(path.join(app.getAppPath(), 'media', 'app.html'))
  return win
}

function openApp(): void {
  if (!appWin || appWin.isDestroyed()) appWin = createAppWindow()
  if (appWin.isMinimized()) appWin.restore()
  appWin.show()
  appWin.focus()
}

function postCard(): void {
  if (!shown) return
  post({
    type: 'card',
    card: { ...shown, target: TARGET, native: settings.native, autoRead: settings.autoRead },
    config: config(),
    pinned,
  })
}

/** Starts a new card by the pointer (or where a pinned card stands) and returns its id. */
function openCard(kind: CardKind, state: CardState, at: Point): number {
  const id = ++seq
  shown = { id, kind, state }
  stopSpeaking()
  postCard()
  const win = card
  if (!win) return id
  if (!win.isVisible()) {
    const area = screen.getDisplayNearestPoint(at).workArea
    win.setBounds(placeNear(at, { width: CARD_WIDTH, height: Math.max(CARD_MIN, win.getBounds().height) }, area))
    shownAt = Date.now()
    win.show()
  }
  win.focus()
  return id
}

/** Changes what card `id` shows, if it is still the one on screen. */
function setState(id: number, state: CardState): void {
  if (!shown || shown.id !== id) return
  shown = { ...shown, state }
  postCard()
}

function hideCard(): void {
  stopSpeaking()
  // The card plays the natural voice's audio, and its own voices, itself: they stop there.
  post({ type: 'stop' })
  pinned = false
  card?.hide()
}

function setCardHeight(px: number): void {
  const win = card
  if (!win || win.isDestroyed()) return
  const bounds = win.getBounds()
  const height = Math.round(Math.min(CARD_MAX, Math.max(CARD_MIN, px)))
  if (height === bounds.height) return
  win.setBounds(resize(bounds, height, screen.getDisplayMatching(bounds).workArea))
}

function onMessage(message: ToHost): void {
  switch (message.type) {
    case 'ready':
      cardReady = true
      postCard()
      post({ type: 'natural', state: naturalState() })
      post({ type: 'common', words: commonWords() })
      void sendHostVoices()
      return
    case 'speak':
      natural.stop()
      speaker.speak(message.id, message.items.join(message.separator), message.lang, systemVoiceName(settings.voice), settings.rate)
      return
    case 'speakNatural':
      speaker.stop()
      natural.speak(message.id, message.items, message.voice, message.rate)
      return
    case 'naturalAt':
      natural.at(message.id, message.index)
      return
    case 'downloadNatural':
      voiceStore.download().catch(error => console.warn('2Talker: the natural voice did not download', error))
      return
    case 'dismissNatural':
      saveSettings({ naturalDismissed: true })
      post({ type: 'natural', state: naturalState() })
      return
    case 'stop':
      stopSpeaking()
      return
    case 'openSpeechSettings':
      void shell.openExternal('ms-settings:speech')
      return
    case 'openLanguageSettings':
      void shell.openExternal('ms-settings:regionlanguage')
      return
    case 'height':
      setCardHeight(message.px)
      return
    case 'pin':
      pinned = message.on
      return
    case 'close':
      hideCard()
      return
    case 'retry':
      if (last && shown?.id === last.id) void translateInto(last.id, last.text, last.kind, last.note)
      return
    case 'lookup':
      lookupWord(message.word)
      return
    case 'saveWord':
      saveWord(message.word, message.sentence)
      return
    case 'unsaveWord':
      unsaveWord(message.word)
      return
    case 'appReady':
      appReady = true
      postApp()
      return
    case 'saveSettings':
      saveSettings(message.patch)
      return
    case 'removeWord':
      words.remove(message.id)
      postApp()
      return
    case 'exportWords':
      exportWords().catch(error => console.warn('2Talker: could not save the words', error))
      return
    case 'copyWords':
      clipboard.writeText(wordsText(words.list()))
      return
    case 'checkUpdates':
      updater.check()
      return
  }
}

async function sendHostVoices(): Promise<void> {
  if (!hostVoices) {
    hostVoices = await listHostVoices()
    refreshTray()
    postApp()
  }
  post({ type: 'hostVoices', voices: hostVoices, canSpeak: Speaker.canSpeak(), platform: process.platform })
}

// ---------------------------------------------------------------- translating

let translator: Translator

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Translates `text` into card `id`: the translator's download first, the
 * first time. An English text is shown, and read, at once, its translation
 * coming in under it; a text in the person's language waits for its English.
 */
async function translateInto(id: number, text: string, kind: CardKind, note?: string): Promise<void> {
  last = { id, text, kind, ...(note ? { note } : {}) }
  const native = langCode(settings.native)
  const split = splitText(text.slice(0, MAX_TEXT_CHARS), settings.native)
  const notes = [note, text.length > MAX_TEXT_CHARS ? 'Long text: only the beginning is translated.' : undefined].filter(Boolean)
  const noted = notes.length ? { note: notes.join(' ') } : {}
  const early = englishReady(split) ? englishHtml(split.lines) : undefined
  const pending = (translation: Exclude<TranslationState, { status: 'ready' }>) =>
    setState(id, early ? { status: 'done', html: early, translation, ...noted } : translation)
  try {
    pending({ status: 'translating' })
    if (translator.state(native).status !== 'ready') {
      await translator.prepare(native, s => {
        if (s.status === 'downloading') pending({ status: 'downloading', progress: s.progress, size: s.size })
      })
      pending({ status: 'translating' })
    }
    const lines = await translateLines(split, settings.native, translator.translate)
    setState(id, { status: 'done', html: englishHtml(lines), translation: { status: 'ready', html: translationHtml(lines) }, ...noted })
  } catch (error) {
    pending({ status: 'failed', message: messageOf(error) })
  }
}

function translateText(text: string, kind: CardKind, at: Point): void {
  const id = openCard(kind, { status: 'translating' }, at)
  void translateInto(id, text, kind)
}

/** Reads a snipped picture with Windows OCR, then translates what it says. */
async function readScreenshot(png: Buffer): Promise<void> {
  const id = openCard('screenshot', { status: 'reading' }, screen.getCursorScreenPoint())
  const file = path.join(app.getPath('temp'), `2talker-${process.pid}-${id}.png`)
  try {
    fs.writeFileSync(file, png)
    const native = langCode(settings.native)
    const result = await recognize(file, native === 'en' ? ['en'] : [native, 'en'])
    if (!result.lang) return setState(id, { status: 'no-ocr' })
    const text = paragraphsOf(result.lines)
    if (!text.trim()) return setState(id, { status: 'empty' })
    // An English engine reads Cyrillic or Greek letters as Latin look-alikes.
    const misread = scriptFor(settings.native) !== 'Latin' && result.lang.split('-')[0]?.toLowerCase() !== native
    const note = misread
      ? `Windows has no text recognition for ${settings.native}, so ${settings.native} words may come out wrong. Add it in Settings → Language.`
      : undefined
    await translateInto(id, text, 'screenshot', note)
  } catch (error) {
    setState(id, { status: 'failed', message: messageOf(error) })
  } finally {
    fs.rmSync(file, { force: true })
  }
}

function snip(): void {
  hideCard()
  snipSince = Date.now()
  void shell.openExternal('ms-screenclip:')
}

async function translateClipboard(): Promise<void> {
  const text = (await clipboard.readText()).trim()
  if (text) translateText(text, 'selection', screen.getCursorScreenPoint())
  else tray?.displayBalloon({ title: '2Talker', content: 'The clipboard holds no text. Select a text and press Ctrl+C twice.' })
}

/** The picture on the clipboard as PNG, if there is one. */
async function clipboardPng(): Promise<Buffer | undefined> {
  for (const item of await clipboard.read()) {
    if (!item.types.includes('image/png')) continue
    const blob = (await item.getType('image/png')) as Blob
    return Buffer.from(await blob.arrayBuffer())
  }
  return undefined
}

/** Reads the clipboard once the program that changed it is done. */
function afterSettling(read: () => Promise<void>): void {
  setTimeout(() => read().catch(error => console.warn('2Talker: could not read the clipboard', error)), SETTLE_MS)
}

function onClipboardChange(): void {
  const now = Date.now()
  if (snipSince && now - snipSince < SNIP_WAIT_MS) {
    afterSettling(async () => {
      const png = await clipboardPng()
      if (!png || !snipSince) return
      snipSince = 0
      await readScreenshot(png)
    })
    return
  }
  // Copying from the card itself is not a request.
  if (card?.isFocused()) return
  if (!copies.change(now, ctrlHeld())) return
  const at = screen.getCursorScreenPoint()
  afterSettling(async () => {
    const text = (await clipboard.readText()).trim()
    if (text) translateText(text, 'selection', at)
  })
}

function registerSnipKey(): void {
  globalShortcut.unregisterAll()
  let ok = false
  try {
    ok = globalShortcut.register(settings.snipKey, snip)
  } catch {
    ok = false
  }
  snipKeyOk = ok
  // The settings window shows the trouble itself; the balloon is for a start without it.
  if (!ok && !(appWin?.isVisible() ?? false)) {
    tray?.displayBalloon({
      title: '2Talker',
      content: `${keyLabel(settings.snipKey)} is taken by another program. Choose another in the settings, or snip from the tray menu.`,
    })
  }
}

// ---------------------------------------------------------------- tray

function keyLabel(accelerator: string): string {
  return accelerator.replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')
}

function voiceMenu(): MenuItemConstructorOptions[] {
  const choose = (voice: string) => () => saveSettings({ voice })
  const items: MenuItemConstructorOptions[] = [{ label: 'Automatic', type: 'radio', checked: settings.voice === '', click: choose('') }]
  const v = voiceStore.state
  if (v.status === 'ready') {
    for (const voice of NATURAL_VOICES) {
      const value = NATURAL_PREFIX + voice.id
      items.push({ label: naturalLabel(voice), type: 'radio', checked: settings.voice === value, click: choose(value) })
    }
  } else if (v.status === 'downloading') {
    items.push({ label: `Downloading the natural voice… ${Math.round(v.progress * 100)}%`, enabled: false })
  } else if (v.status !== 'unsupported') {
    items.push({
      label: `Download the natural voice (${v.size} MB)`,
      click: () => voiceStore.download().catch(error => console.warn('2Talker: the natural voice did not download', error)),
    })
  }
  const system = (hostVoices ?? []).filter(h => voiceMatches(h.lang, 'en'))
  if (system.length > 0) items.push({ type: 'separator' })
  for (const h of system) items.push({ label: h.name, type: 'radio', checked: settings.voice === h.name, click: choose(h.name) })
  return items
}

function languageMenu(): MenuItemConstructorOptions[] {
  return NATIVES.map(code => findLanguage(code))
    .filter(l => l !== undefined)
    .map(l => ({ label: `${l.native} · ${l.name}`, type: 'radio', checked: settings.native === l.name, click: () => saveSettings({ native: l.name }) }))
}

function refreshTray(): void {
  if (!tray) return
  const menu = Menu.buildFromTemplate([
    { label: 'Open 2Talker…', click: openApp },
    { type: 'separator' },
    { label: `Translate a piece of the screen\t${keyLabel(settings.snipKey)}`, click: snip },
    { label: 'Translate the copied text\tCtrl+C, C', click: () => afterSettling(translateClipboard) },
    { type: 'separator' },
    { label: 'Read aloud when a card opens', type: 'checkbox', checked: settings.autoRead, click: item => saveSettings({ autoRead: item.checked }) },
    { label: 'Voice', submenu: voiceMenu() },
    {
      label: 'Speed',
      submenu: RATES.map(rate => ({ label: rate === 1 ? 'Normal' : `${rate}×`, type: 'radio', checked: settings.rate === rate, click: () => saveSettings({ rate }) })),
    },
    { label: 'Your language', submenu: languageMenu() },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: settings.startWithWindows, click: item => saveSettings({ startWithWindows: item.checked }) },
    { label: 'Quit 2Talker', click: () => app.quit() },
  ])
  tray.setContextMenu(menu)
}

function createTray(): Tray {
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'media', 'icon.png')).resize({ width: 32, height: 32, quality: 'best' })
  const t = new Tray(icon)
  t.setToolTip(`2Talker · Ctrl+C twice to translate a text · ${keyLabel(settings.snipKey)} for a piece of the screen`)
  t.on('click', () => t.popUpContextMenu())
  t.on('double-click', openApp)
  return t
}

function howTo(): string {
  return `Select a text anywhere and press Ctrl+C twice. Press ${keyLabel(settings.snipKey)} to translate a piece of the screen.`
}

/**
 * `2Talker --clipboard` translates the copied text and `2Talker --snip`
 * snips, for a mouse button or a launcher; true when the arguments held one.
 */
function runCommand(argv: readonly string[]): boolean {
  if (argv.includes('--clipboard')) {
    afterSettling(translateClipboard)
    return true
  }
  if (argv.includes('--snip')) {
    snip()
    return true
  }
  return false
}

// ---------------------------------------------------------------- start

function start(): void {
  adoptOldFolder()
  const firstRun = !fs.existsSync(settingsFile())
  settings = readSettings()
  if (firstRun) saveSettings({})
  applyLoginItem()
  setUpSpeech()
  words = new WordStore(path.join(userDir(), 'words.json'))
  updater = new Updater({
    change: () => postApp(),
    ready: version => tray?.displayBalloon({ title: '2Talker', content: `Version ${version} is ready. It installs when 2Talker quits.` }),
  })
  translator = createTranslator(path.join(userDir(), 'models'), unpacked('dist', 'mt-worker.js'), {
    loader: unpacked('vendor', 'bergamot', 'bergamot-translator.js'),
    wasm: unpacked('vendor', 'bergamot', 'bergamot.wasm'),
  })
  tray = createTray()
  refreshTray()
  registerSnipKey()
  card = createCard()
  ipcMain.on('to-host', (_event, message: ToHost) => onMessage(message))
  try {
    stopWatching = watchClipboard(card, onClipboardChange)
  } catch (error) {
    tray.displayBalloon({ title: '2Talker', content: `Ctrl+C twice will not work: ${messageOf(error)}. Use the tray menu.` })
  }
  void sendHostVoices()
  updater.start()
  // The first start opens the window on "How to use".
  if (firstRun) openApp()
  runCommand(process.argv)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // The card reads aloud as soon as a translation is in, before anyone touches it.
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  app.setAppUserModelId('com.ikstro.2talker')
  // Started again, without a command: the window opens.
  app.on('second-instance', (_event, argv) => {
    if (!runCommand(argv)) openApp()
  })
  app.on('before-quit', () => {
    quitting = true
  })
  // The card is hidden, never closed: 2Talker keeps running in the tray.
  app.on('window-all-closed', () => undefined)
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    updater?.dispose()
    stopWatching?.()
    natural?.dispose()
    translator?.dispose()
  })
  void app.whenReady().then(start)
}
