// Altype's main process. It lives in the tray and waits for a text:
//   - Ctrl+C twice in any program, or the listen key: the selected text;
//   - the snip key (Ctrl+Alt+S): Windows' own snipping overlay opens, and the
//     piece of the screen it puts on the clipboard is read with the OCR built
//     into Windows.
// The text is translated offline and shown in the card, a small window by the
// pointer: the text in English on top, read aloud by the natural voice or a
// system one, and its translation under it. Closing the card silences it.
// The translate keys (the selection, Ctrl+Alt+T for a piece of the screen)
// show the same card as a translator instead: the text as it is and its
// translation, from the language it is in into the person's own (from theirs
// into English), the two languages to change or swap.
//
// The app window (media/app.html) holds the notebook of saved words, the
// settings and how to use; the tray menu has the quick switches. The keyboard
// helper (keyboard.ts, kbd-worker.ts) switches and fixes layouts as one types.
// The speech engine (speechhost.ts: Python, installed in parts when first
// wanted) serves Dictate (dictation.ts), Transcribe and the Chrome extension.
//
// %APPDATA%\Altype\ (moved over from 2Talker's or tu-talk's folder, once)
//   settings.json   see settings.ts
//   words.json      the word notebook (words.ts)
//   dictation.json  the phrases dictated lately, 30 days at most (dictationlog.ts)
//   translations.json  the texts translated lately, 30 days at most (translationlog.ts)
//   learning.json   what the layout fixer learned from the person's typing (learning.ts)
//   voice\          the natural voice, downloaded on request
//   dict\           word dictionaries for languages other than Russian
//   models\         the translator's models, one folder per language pair
//   speech.json     the speech engine's settings (engine/settings.py), speech.log
// %LOCALAPPDATA%\Altype\speech\   the speech engine's Python, packages and models

import * as fs from 'node:fs'
import * as path from 'node:path'

import { execFile } from 'node:child_process'

import { app, BrowserWindow, clipboard, ClipboardItem, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, screen, shell, Tray, type Rectangle } from 'electron'

import { openInChrome } from './chrome'
import { DoubleCopy } from './clipboard'
import { Dictation } from './dictation'
import { DictationLog } from './dictationlog'
import { DOWNLOADABLE, DictionaryStore } from './dictstore'
import { openStream } from './download'
import { frameWindow, WIN11 } from './dwm'
import { createTranslator, NATIVES } from './engine'
import { hotkeyLabel, isAccelerator } from './hotkey'
import { KeyboardHelper, keyboardLayouts } from './keyboard'
import { loadVoiceSpeed, nextVoiceSpeed, saveVoiceSpeed, type VoiceSpeed } from './device'
import { defaultNative, findLanguage, langCode, scriptFor } from './languages'
import { convertText, nextLayout, sourceLayout, type KeyTable } from './layoutfix'
import { LearnStore } from './learning'
import { lookup, type Dictionary } from './lemma'
import { log, logTo } from './log'
import { systemVoiceName, type NaturalState } from './natural'
import { recognize } from './ocr'
import { adoptOldFolders } from './oldfolder'
import { paragraphsOf } from './ocrtext'
import { placeByTray, placeNear, resize, type Point } from './placement'
import type { AppTab, AppView, CardKind, CardState, DictationMode, DictionaryStatus, GlossMissing, HostCall, HostVoice, TextResult, ToHost, ToView, TranslationState, TrayCommand, TrayView, ViewConfig } from './protocol'
import { englishHtml, translationHtml } from './render'
import { CARD_WIDTH, DEFAULTS, myLanguages, normalize, TARGET, type Settings } from './settings'
import { Speaker, listHostVoices } from './speech'
import { SpeechHost } from './speechhost'
import { SPEECH_PORT } from './speechservice'
import { NaturalSpeaker } from './synth'
import { englishReady, languageOf, splitText, targetFor, translateLines, translatePlain, type LanguageWords } from './translate'
import { TranslationLog } from './translationlog'
import type { Translator } from './translator'
import { Updater } from './update'
import manifest from './voice-manifest.json'
import { VoiceStore, type VoiceManifest } from './voicestore'
import { focus, focusedElement, release } from './uia'
import { allowForeground, ctrlHeld, inFront, keysLetGo, pressAddressBar, pressCopy, pressEnter, pressPaste, pressSelectBack, watchClipboard } from './winclip'
import { exeOf, focusWindow, foreground, installedLayouts, layoutTable, windowedApps } from './winkbd'
import { ankiTsv, WordStore, wordsText } from './words'

const CARD_MIN = 96
/** Without a height set by hand, a card grows to this share of the screen. */
const CARD_AUTO_SHARE = 0.7
/** The offline translator takes a few hundred ms a sentence: a longer text is cut. */
const MAX_TEXT_CHARS = 6000
/** How long after the snip shortcut a picture on the clipboard counts as the snip. */
const SNIP_WAIT_MS = 120_000
/** Programs put a copy on the clipboard in steps; it is read once they are done. */
const SETTLE_MS = 60
/** How long after the selection shortcut presses Ctrl+C its copy may come. */
const SELECT_WAIT_MS = 600
/** How long after Altype's own write to the clipboard a change is still taken for that write. */
const OWN_CLIPBOARD_MS = 300
/** A selection converted into another layout is selected again up to this long. */
const RESELECT_MOST = 400
/** Layout switchers that would fix words a second time, by their .exe name. */
const RIVALS: Record<string, string> = { 'everylang.exe': 'EveryLang', 'punto.exe': 'Punto Switcher' }
/** Other programs that watch the keyboard, by their .exe name: no harm, named on the Keyboard page. */
const KEYBOARD_APPS: Record<string, string> = {
  'autohotkey.exe': 'AutoHotkey',
  'autohotkey64.exe': 'AutoHotkey',
  'autohotkey32.exe': 'AutoHotkey',
  'autohotkeyu64.exe': 'AutoHotkey',
  'autohotkeyu32.exe': 'AutoHotkey',
  'whispertyping.exe': 'WhisperTyping',
  'powertoys.keyboardmanagerengine.exe': 'PowerToys Keyboard Manager',
  'listary.exe': 'Listary',
  'qtranslate.exe': 'QTranslate',
  'logioptionsplus_agent.exe': 'Logitech Options+',
}
/** The tray's panel: its width; a click on the tray icon this soon after the panel hid on that click's blur only closes it. */
const TRAY_WIDTH = 340
const TRAY_REOPEN_MS = 300
/** Ctrl+C pressed twice, as a card's header draws the key that called it. */
const DOUBLE_COPY = 'Control+C*2'
/** The settings that are keys of actions. */
const ACTION_KEYS: readonly (keyof Settings)[] = ['selectKey', 'snipKey', 'translateKey', 'textKey', 'inPlaceKey', 'switchKey', 'fixKey', 'pauseKey', 'windowKey']
/** The settings the keyboard thread is given (besides the keys). */
const KEYBOARD_SETTINGS: readonly (keyof Settings)[] = [
  'layouts',
  'languages',
  'switchOn',
  'layoutKeys',
  'autoFix',
  'fixTwoCaps',
  'fixCapsLock',
  'keepCaps',
  'fixOnPause',
  'fixSound',
  'learn',
  'fixKeyOn',
  'apps',
  'keepWords',
  'layoutBadge',
  'trayLayout',
  'quietFullScreen',
  'paused',
]
/** The links the About tab may open. */
const LINKS = new Set([
  'https://ikstro.com',
  'https://github.com/ikstro/altype',
  'https://github.com/ikstro/altype/releases',
  'https://github.com/ikstro/altype/blob/main/NOTICE',
  // The steps to the speakers' model: an account, the model's terms, a Read token.
  'https://huggingface.co/join',
  'https://huggingface.co/pyannote/speaker-diarization-community-1',
  'https://huggingface.co/settings/tokens',
])

/** The settings that are Dictate's keys: registered only once the speech engine is installed. */
const DICTATION_KEYS: readonly (keyof Settings)[] = ['dictateKey', 'englishKey', 'noteKey', 'againKey']

// One Altype at a time, whichever folder it keeps its things in: the lock is taken on Altype's own
// folder first, before a test run moves to its own. A second copy (another start, `npm start`, a test
// run) hands its arguments to the first and quits; the first opens its window.
const theOnlyOne = app.requestSingleInstanceLock()
// A test run (ALTYPE_TEST_HOME) keeps to its own folders and port; the installed Altype is quit first.
const TEST_HOME = process.env.ALTYPE_TEST_HOME
if (TEST_HOME) app.setPath('userData', TEST_HOME)
const speechPort = TEST_HOME ? Number(process.env.ALTYPE_TEST_PORT) || 8797 : SPEECH_PORT

const userDir = () => app.getPath('userData')
const settingsFile = () => path.join(userDir(), 'settings.json')
/** A file the packaged app keeps outside its archive: the workers run as separate processes. */
const unpacked = (...parts: string[]) => path.join(app.getAppPath(), ...parts).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

/**
 * uv's own download cache on this computer, as uv finds it (UV_CACHE_DIR, else %LOCALAPPDATA%\uv\cache),
 * when it is there: the speech engine's packages already in it are taken from it, not downloaded again.
 */
function sharedUvCache(): string | undefined {
  const dir = process.env.UV_CACHE_DIR || (process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'uv', 'cache') : '')
  return dir && fs.existsSync(dir) ? dir : undefined
}

let settings: Settings
let tray: Tray | undefined
let card: BrowserWindow | undefined
let cardReady = false
let pinned = false
let shownAt = 0
/** The card on screen; a newer text replaces it. */
let seq = 0
let shown: { id: number; kind: CardKind; state: CardState; via?: string } | undefined
let last: { id: number; text: string; kind: CardKind; note?: string } | undefined
let snipSince = 0
/** What the snip is for: the card to listen to, or the translator; the key that asked for it. */
let snipFor: Purpose = 'listen'
let snipVia: string | undefined
/** Altype is using the clipboard itself (converting a selection, pasting, putting it back): its changes are no requests. */
let clipboardBusy = false
/** Its last write is announced a moment later, until then. */
let ownClipboardUntil = 0
let stopWatching: (() => void) | undefined
let hostVoices: HostVoice[] | undefined
const copies = new DoubleCopy()
let appWin: BrowserWindow | undefined
let appReady = false
let quitting = false
let keysOk = { snip: true, select: true, translate: true, text: true, inPlace: true, pause: true, window: true }
let speechKeysOk = { dictate: true, note: true, english: true, again: true }
let speech: SpeechHost
let dictation: Dictation
/** What a click on the tray's balloon does, for the balloon shown last. */
let balloonClick: (() => void) | undefined
let keyboard: KeyboardHelper
let keyboardTrouble: string | undefined
let lastApp: string | undefined
/** A program run as administrator was in front lately: Windows keeps its keys from Altype's hooks. */
let elevatedApp: string | undefined
/** The layout in front and Caps Lock, for the tray's icon (when it shows the layout). */
let frontLayout: { layout: string; caps: boolean } | undefined
let learned: LearnStore
let translationLog: TranslationLog
let rivals: string[] = []
let keyboardApps: string[] = []
let foreignKeys = false
let trayPanel: BrowserWindow | undefined
let trayReady = false
let trayHeight = 320
let trayShownAt = 0
let trayHiddenAt = 0
/**
 * A selection key pressed Ctrl+C: the next copy is the selection, shown by
 * the pointer to listen to or translate; the window it was selected in, and
 * the clipboard as it was, to put back.
 */
let copyWanted: { since: number; at: Point; purpose: Purpose; window: bigint; field: unknown; saved: Record<string, Blob>[]; via?: string } | undefined
/**
 * The translator open on a selection: the window to paste its translation
 * into, and the field the selection was in (UI Automation's element), to give
 * the keyboard back to: VS Code's chat, brought back to the front, does not
 * take it back by itself.
 */
let pasteTarget: { id: number; window: bigint; field: unknown } | undefined
/** The card's bounds when its edge began to be dragged; the content's height, which the card follows otherwise. */
let resizeFrom: Rectangle | undefined
let contentHeight = 160
/** The card fills the work area: its bounds before, to go back to. */
let maximizedFrom: Rectangle | undefined
/** Whether the card was pinned before it was maximized: it goes back to that on restore. */
let pinnedBefore = false
/** The tab the app window opens on, once its page is ready. */
let pendingTab: AppTab | undefined
/** The transcript it shows then (a note left in Transcripts, from its balloon). */
let pendingTranscript: string | undefined
let words: WordStore
let dictationLog: DictationLog
let updater: Updater
/** The most common English words, for the card's dotted lines; read once. */
let common: string[] | undefined

// ---------------------------------------------------------------- settings

function systemNative(): string {
  return defaultNative([app.getLocale(), ...app.getPreferredSystemLanguages()], TARGET)
}

/** The app was called tu-talk at first: its settings, translator and voice move over, once. */
function adoptOldFolder(): void {
  adoptOldFolders(app.getPath('appData'), userDir(), (message, error) => console.warn(message, error))
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
    console.warn('Altype: could not save the settings', error)
  }
  if ('startWithWindows' in patch) applyLoginItem()
  // A key may be Electron's or the keyboard thread's (hotkey.ts isAccelerator): both learn of any change.
  if ([...ACTION_KEYS, ...DICTATION_KEYS, 'paused'].some(k => k in patch)) registerShortcuts()
  if ([...ACTION_KEYS, ...DICTATION_KEYS, ...KEYBOARD_SETTINGS].some(k => k in patch)) applyKeyboard()
  if ('betaUpdates' in patch) updater?.setBeta(settings.betaUpdates)
  if ('trayLayout' in patch && !settings.trayLayout) frontLayout = undefined
  // Paused while a phrase is recorded: the phrase is dropped, as Esc would.
  if (patch.paused && settings.paused) dictation?.cancel()
  if ('theme' in patch) applyTheme()
  // The speech models are chosen from these (speechplan.ts), and the words to spell go with the plan: sent to the engine again.
  if (speech && (['native', 'speechPrefer', 'dictationModel', 'transcriptsModel', 'speechTestAgreed', 'vocabulary'] as const).some(k => k in patch)) speech.replan()
  refreshTray()
  if (shown) postCard()
  postApp()
}

function applyLoginItem(): void {
  // A development run would register electron.exe itself.
  if (!app.isPackaged) return
  // Registered under the app's id, the one 2Talker used too: this replaces its entry.
  app.setLoginItemSettings({ openAtLogin: settings.startWithWindows })
  // tu-talk's entry had its own name and points at a program long gone.
  app.setLoginItemSettings({ openAtLogin: false, name: 'com.ikstro.tu-talk' })
}

function config(): ViewConfig {
  return { voice: settings.voice, rate: settings.rate, wordHint: settings.wordHint, rareWords: settings.rareWords, oneAtATime: settings.oneAtATime }
}

/** What a window shows before its page paints: the card's and the badge's surface, the app window's and the tray's ground (theme.css). */
const cardColor = () => (nativeTheme.shouldUseDarkColors ? '#2b2b2b' : '#fbfbfb')
const appColor = () => (nativeTheme.shouldUseDarkColors ? '#202020' : '#f3f3f3')
/** The windows' edge, drawn by Windows 11 (dwm.ts): theme.css's `--border`. */
const borderColor = () => (nativeTheme.shouldUseDarkColors ? '#3d3d3d' : '#e5e5e5')

/** The page to load, told whether Windows draws its edge (then it draws none of its own). */
const frameQuery = WIN11 ? { query: { frame: 'dwm' } } : undefined

/** Light, dark or as Windows is: the pages follow `prefers-color-scheme`, which this sets. */
function applyTheme(): void {
  nativeTheme.themeSource = settings.theme
  applyColors()
}

/** The open windows' ground and edge in the theme's colors: on a change of the setting, and of Windows' own theme. */
function applyColors(): void {
  if (card && !card.isDestroyed()) {
    card.setBackgroundColor(cardColor())
    frameWindow(card, { corner: 'round', border: borderColor() })
  }
  if (appWin && !appWin.isDestroyed()) {
    appWin.setBackgroundColor(appColor())
    frameWindow(appWin, { corner: 'default', border: borderColor() })
  }
  if (trayPanel && !trayPanel.isDestroyed()) {
    trayPanel.setBackgroundColor(appColor())
    frameWindow(trayPanel, { corner: 'round', border: borderColor() })
  }
  dictation?.reframe()
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
  voiceSpeed = loadVoiceSpeed(deviceFile())
  natural = new NaturalSpeaker(
    unpacked('dist', 'voice-worker.js'),
    () => voiceStore.paths,
    {
      audio: (id, index, samples, words) => post({ type: 'naturalAudio', id, index, samples, words }),
      failed: (id, message) => post({ type: 'naturalFailed', id, message }),
      phonemes: (text, ipa) => {
        if (ipa) post({ type: 'ipa', word: text, ipa })
      },
      made: (took, seconds) => voiceMade(took, seconds),
    },
    // The physical cores, once Windows has said them (speech.probe); half the threads until then.
    { threads: () => (speech?.profile.at ? speech.profile.cpu.cores : undefined) },
  )
  dictionaries = new DictionaryStore({
    bundledDir: path.join(app.getAppPath(), 'media', 'dict'),
    cacheDir: path.join(userDir(), 'dict'),
    fetchGz: async url => {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return new Uint8Array(await res.arrayBuffer())
    },
    onReady: () => post({ type: 'dictReady' }),
    // The setup page follows the download: started, here or failed.
    onChange: () => postApp(),
  })
}

const deviceFile = () => path.join(userDir(), 'device.json')
/** How fast the natural voice makes speech on this computer, measured while it reads. */
let voiceSpeed: VoiceSpeed | undefined
/** Shown once a few sentences were made, so one slow start does not decide. */
const VOICE_SURE_AFTER = 3

function voiceMade(took: number, seconds: number): void {
  const before = naturalState().rtf
  voiceSpeed = nextVoiceSpeed(voiceSpeed, took, seconds)
  if (voiceSpeed && voiceSpeed.n % 5 === 0) saveVoiceSpeed(deviceFile(), voiceSpeed)
  const after = naturalState().rtf
  // The window learns of it when it first shows, and when the voice crosses being slower than it plays.
  if (before === undefined ? after !== undefined : (before > 1) !== ((after ?? 0) > 1)) postApp()
}

function naturalState(): NaturalState {
  const rtf = voiceSpeed && voiceSpeed.n >= VOICE_SURE_AFTER ? Math.round(voiceSpeed.rtf * 100) / 100 : undefined
  return { ...voiceStore.state, dismissed: settings.naturalDismissed, ...(rtf !== undefined ? { rtf } : {}) }
}

/** The word dictionary for the person's language as the window shows it; "absent" is one that can be downloaded. */
function dictionaryStatus(): DictionaryStatus {
  const code = langCode(settings.native)
  const status = dictionaries.status(code)
  if (status === 'off') return DOWNLOADABLE.has(code) ? 'absent' : 'none'
  return status
}

/** The translator for the person's language downloaded ahead of its first use; the window follows it at most four times a second. */
function prepareTranslator(): void {
  let last = 0
  translator
    .prepare(langCode(settings.native), () => {
      if (Date.now() - last < 250) return
      last = Date.now()
      postApp()
    })
    .catch(error => console.warn('Altype: the translator did not download', error))
    .finally(() => postApp())
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
    defaultPath: path.join(app.getPath('documents'), 'Altype words.txt'),
    filters: [{ name: 'Text for Anki', extensions: ['txt'] }],
  })
  if (filePath) fs.writeFileSync(filePath, ankiTsv(words.list()) + '\n', 'utf8')
}

/** The settings saved as a file, to keep or to take to another computer. */
async function exportSettings(): Promise<void> {
  const options: Electron.SaveDialogOptions = {
    title: 'Save the settings',
    defaultPath: path.join(app.getPath('documents'), 'Altype settings.json'),
    filters: [{ name: 'Altype settings', extensions: ['json'] }],
  }
  const { filePath } = appWin ? await dialog.showSaveDialog(appWin, options) : await dialog.showSaveDialog(options)
  if (filePath) fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

/** Settings read from a file the person picks: what it holds replaces them, the rest as it was; this computer's place for the dictation badge stays. */
async function importSettings(): Promise<void> {
  const options: Electron.OpenDialogOptions = { title: 'Open saved settings', defaultPath: app.getPath('documents'), filters: [{ name: 'Altype settings', extensions: ['json'] }], properties: ['openFile'] }
  const { canceled, filePaths } = appWin ? await dialog.showOpenDialog(appWin, options) : await dialog.showOpenDialog(options)
  const file = filePaths[0]
  if (canceled || !file) return
  try {
    const read = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    if (!read || typeof read !== 'object' || Array.isArray(read)) throw new Error('it holds no settings')
    const next = normalize({ ...settings, ...read, dictationBadge: settings.dictationBadge, setupDone: true }, settings.native)
    saveSettings(next)
  } catch (error) {
    void dialog.showMessageBox({ type: 'warning', title: 'Altype', message: 'These settings could not be read', detail: messageOf(error) })
  }
}

/** All settings back to how they came, after a question; the person's language, the setup done and what Altype learned stay. */
async function resetSettings(): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: 'Altype',
    message: 'Reset all settings?',
    detail: 'Keys, switches and lists go back to how they came. Your language, words, transcripts and what Altype learned from your typing stay.',
    buttons: ['Reset', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  }
  const { response } = appWin ? await dialog.showMessageBox(appWin, options) : await dialog.showMessageBox(options)
  if (response !== 0) return
  saveSettings({ ...DEFAULTS, native: settings.native, languages: settings.languages, setupDone: true, introSeen: true })
}

// ---------------------------------------------------------------- the card

function createCard(): BrowserWindow {
  const win = new BrowserWindow({
    width: settings.cardWidth,
    height: 160,
    minWidth: CARD_WIDTH.min,
    minHeight: CARD_MIN,
    show: false,
    frame: false,
    // Its edges drag like any window's; the size is kept for the next cards.
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Altype',
    backgroundColor: cardColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  frameWindow(win, { corner: 'round', border: borderColor() })
  // A drag of an edge (never the card's own growing) sets the width, or how tall a card may grow.
  win.on('will-resize', () => {
    if (!maximizedFrom) resizeFrom ??= win.getBounds()
  })
  win.on('resized', () => {
    if (maximizedFrom) return
    const from = resizeFrom
    resizeFrom = undefined
    if (!from) return
    const to = win.getBounds()
    const patch: Partial<Settings> = {}
    if (to.width !== from.width) patch.cardWidth = to.width
    if (to.height !== from.height) patch.cardHeight = to.height
    if (Object.keys(patch).length > 0) saveSettings(patch)
    fitCard()
  })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.removeMenu()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  // Clicking another window puts the card away, unless it is pinned or has only just opened.
  win.on('blur', () => {
    if (!pinned && Date.now() - shownAt > 400) hideCard()
  })
  // A double click on the bar (the drag region, Windows' caption) maximizes or restores it, as a window's title bar does.
  const WM_NCLBUTTONDBLCLK = 0x00a3
  const HTCAPTION = 2
  win.hookWindowMessage(WM_NCLBUTTONDBLCLK, wParam => {
    if (wParam.readUInt32LE(0) === HTCAPTION) maximizeCard(!maximizedFrom)
  })
  void win.loadFile(path.join(app.getAppPath(), 'media', 'card.html'), frameQuery)
  return win
}

function post(message: ToView): void {
  if (card && cardReady && !card.isDestroyed()) card.webContents.send('to-view', message)
}

/** What a text is picked for: the card that reads its English aloud, the translator, or its translation pasted over it. */
type Purpose = 'listen' | 'translate' | 'inPlace'

let languageWordsRead: LanguageWords | undefined
/** The words that tell a text's language, read once. */
function languageWords(): LanguageWords {
  if (!languageWordsRead) {
    const read = (file: string) => {
      try {
        return fs.readFileSync(path.join(app.getAppPath(), 'media', file), 'utf8')
      } catch {
        return ''
      }
    }
    const lists = JSON.parse(read('lang-words.json') || '{}') as Record<string, string[]>
    languageWordsRead = {
      common: Object.fromEntries(Object.entries(lists).map(([code, words]) => [code, new Set(words)])),
      english: new Set(read(path.join('layout', 'en.txt')).split('\n')),
    }
  }
  return languageWordsRead
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
    keysOk,
    translator: translator.state(langCode(settings.native)).status,
    translatorState: translator.state(langCode(settings.native)),
    dictionary: { status: dictionaryStatus() },
    layouts: keyboardLayouts(),
    ...(keyboardTrouble ? { keyboardTrouble } : {}),
    ...(lastApp ? { lastApp } : {}),
    ...(elevatedApp ? { elevatedApp } : {}),
    learned: { alwaysFix: [...learned.alwaysFix], myWords: [...learned.myWords] },
    translations: translationLog.list(10),
    rivals,
    keyboardApps,
    foreignKeys,
    speech: speech.view(speechKeysOk),
    dictation: { recent: dictationLog.list(10) },
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
    // The page draws its own bar (the mark, the pills, minimize and close); the edges still resize.
    frame: false,
    title: 'Altype',
    icon: path.join(app.getAppPath(), 'media', 'icon.png'),
    backgroundColor: appColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  frameWindow(win, { corner: 'default', border: borderColor() })
  win.removeMenu()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  // The page's maximize button shows Maximize or Restore, whichever way the window got there (a double click on the bar too).
  win.on('maximize', () => postAppWindow())
  win.on('unmaximize', () => postAppWindow())
  // A run from source shows the page's errors in the terminal.
  if (!app.isPackaged) {
    win.webContents.on('console-message', m => console.warn(`Altype app window: ${m.message} (${m.sourceId}:${m.lineNumber})`))
    win.webContents.on('did-fail-load', (_event, code, description) => console.warn(`Altype app window did not load: ${code} ${description}`))
  }
  // Closing hides: Altype lives in the tray.
  win.on('close', event => {
    if (quitting) return
    event.preventDefault()
    win.hide()
  })
  win.on('closed', () => {
    appWin = undefined
    appReady = false
  })
  void win.loadFile(path.join(app.getAppPath(), 'media', 'app.html'), frameQuery)
  return win
}

/** Whether the app window fills the screen, for its maximize button. */
function postAppWindow(): void {
  if (appWin && appReady && !appWin.isDestroyed()) appWin.webContents.send('to-view', { type: 'appWindow', maximized: appWin.isMaximized() } satisfies ToView)
}

/** Shows the app window, on `tab` if one is named. */
function openApp(tab?: AppTab): void {
  if (!appWin || appWin.isDestroyed()) appWin = createAppWindow()
  findRivals()
  if (tab) {
    if (appReady) appWin.webContents.send('to-view', { type: 'appTab', tab } satisfies ToView)
    else pendingTab = tab
  }
  if (appWin.isMinimized()) appWin.restore()
  appWin.show()
  appWin.focus()
}

/** The app window on one transcript. */
function openTranscript(id: string): void {
  openApp('transcripts')
  if (appReady) appWin?.webContents.send('to-view', { type: 'openTranscript', id } satisfies ToView)
  else pendingTranscript = id
}

function postCard(): void {
  if (!shown) return
  post({
    type: 'card',
    card: { ...shown, target: TARGET, native: settings.native, autoRead: settings.autoRead },
    config: config(),
    pinned,
    maximized: !!maximizedFrom,
  })
}

/** Starts a new card by the pointer (or where a pinned card stands) and returns its id. */
function openCard(kind: CardKind, state: CardState, at: Point, via?: string): number {
  const id = ++seq
  shown = { id, kind, state, ...(via ? { via } : {}) }
  stopSpeaking()
  postCard()
  const win = card
  if (!win) return id
  if (!win.isVisible()) {
    const area = screen.getDisplayNearestPoint(at).workArea
    win.setBounds(placeNear(at, { width: settings.cardWidth, height: Math.max(CARD_MIN, win.getBounds().height) }, area))
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
  // A translation the translator holds as it closes is kept for the Translate page.
  const state = shown?.state
  if (state?.status === 'text' && state.result.status === 'ready' && card?.isVisible()) logTranslation(state.text, state.result.text, state.result.from, state.result.to)
  stopSpeaking()
  // The card plays the natural voice's audio, and its own voices, itself: they stop there.
  post({ type: 'stop' })
  pinned = false
  card?.hide()
  // The next card opens at its usual size.
  if (maximizedFrom && card && !card.isDestroyed()) {
    card.setResizable(true)
    card.setBounds(maximizedFrom)
  }
  maximizedFrom = undefined
}

/**
 * The card fills the work area of its screen (pinned meanwhile: it stays until closed or restored),
 * or goes back to its bounds and pin state before, kept inside that screen, and to its content's height.
 */
function maximizeCard(on: boolean): void {
  const win = card
  if (!win || win.isDestroyed() || on === !!maximizedFrom) return
  if (on) {
    const bounds = win.getBounds()
    maximizedFrom = bounds
    resizeFrom = undefined
    pinnedBefore = pinned
    pinned = true
    win.setResizable(false)
    win.setBounds(screen.getDisplayMatching(bounds).workArea)
  } else {
    const from = maximizedFrom ?? win.getBounds()
    maximizedFrom = undefined
    pinned = pinnedBefore
    const area = screen.getDisplayMatching(win.getBounds()).workArea
    const width = Math.min(from.width, area.width)
    const x = Math.min(Math.max(from.x, area.x), area.x + area.width - width)
    win.setResizable(true)
    win.setBounds(resize({ ...from, x, width }, from.height, area))
    fitCard()
  }
  postCard()
}

/** The card is as tall as its content, up to the height set by hand or most of the screen; never while its edge is dragged or it is maximized. */
function fitCard(): void {
  const win = card
  if (!win || win.isDestroyed() || resizeFrom || maximizedFrom) return
  const bounds = win.getBounds()
  const area = screen.getDisplayMatching(bounds).workArea
  const cap = settings.cardHeight || Math.round(area.height * CARD_AUTO_SHARE)
  const height = Math.round(Math.min(cap, Math.max(CARD_MIN, contentHeight)))
  if (height === bounds.height) return
  win.setBounds(resize(bounds, height, area))
}

function setCardHeight(px: number): void {
  contentHeight = px
  fitCard()
}

function onMessage(message: ToHost): void {
  if (dictation?.onMessage(message)) return
  switch (message.type) {
    case 'clearDictation':
      dictation.clearLog()
      return
    case 'clearTranslations':
      translationLog.clear()
      postApp()
      return
    case 'unlearn':
      learned.remove(message.list, message.word)
      applyKeyboard()
      postApp()
      return
    case 'forgetLearned':
      learned.forget()
      applyKeyboard()
      postApp()
      return
    case 'exportSettings':
      exportSettings().catch(error => console.warn('Altype: could not save the settings file', error))
      return
    case 'importSettings':
      importSettings().catch(error => console.warn('Altype: could not read the settings file', error))
      return
    case 'resetSettings':
      resetSettings().catch(error => console.warn('Altype: could not reset the settings', error))
      return
    case 'installSpeech':
      speech.install(message.parts, message.models).then(
        () => (registerShortcuts(), applyKeyboard()),
        error => console.warn('Altype: the speech engine did not install', error),
      )
      return
    case 'prepareTranslator':
      prepareTranslator()
      return
    case 'prepareDictionary':
      dictionaries.get(langCode(settings.native), true)
      return
    case 'testSpeech':
      saveSettings({ speechTestAgreed: true })
      void speech.test(true)
      return
    case 'declineSpeechTest':
      saveSettings({ speechTestDeclinedKey: speech.declineKey(), speechTestDeclinedAt: Date.now() })
      return
    case 'downloadSpeechModel':
      void speech.downloadModel(message.model).then(() => postApp())
      return
    case 'removeSpeech':
      void speech.remove().then(() => (registerShortcuts(), applyKeyboard()))
      return
    case 'restartSpeech':
      speech.restart()
      return
    case 'showInFolder':
      shell.showItemInFolder(message.path)
      return
    case 'openPath':
      void shell.openPath(message.path)
      return
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
      natural.speak(message.id, message.items, message.voice, message.rate, message.ahead)
      return
    case 'naturalAt':
      natural.at(message.id, message.index)
      return
    case 'downloadNatural':
      voiceStore.download().catch(error => console.warn('Altype: the natural voice did not download', error))
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
    case 'maximize':
      maximizeCard(message.on)
      return
    case 'close':
      hideCard()
      return
    case 'retry':
      if (last && shown?.id === last.id) void translateInto(last.id, last.text, last.kind, last.note)
      return
    case 'translateText':
      void translateTextCard(message.id, message.text, message.from, message.to)
      return
    case 'copyText':
      void clipboard.writeText(message.text)
      return
    case 'pasteText':
      pasteTranslation(message.id, message.text).catch(error => console.warn('Altype: could not paste the translation', error))
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
      postAppWindow()
      if (pendingTab) appWin?.webContents.send('to-view', { type: 'appTab', tab: pendingTab } satisfies ToView)
      if (pendingTranscript) appWin?.webContents.send('to-view', { type: 'openTranscript', id: pendingTranscript } satisfies ToView)
      pendingTab = undefined
      pendingTranscript = undefined
      return
    case 'saveSettings':
      saveSettings(message.patch)
      return
    case 'removeWord':
      words.remove(message.id)
      postApp()
      return
    case 'exportWords':
      exportWords().catch(error => console.warn('Altype: could not save the words', error))
      return
    case 'copyWords':
      clipboard.writeText(wordsText(words.list()))
      return
    case 'checkUpdates':
      updater.check()
      return
    case 'openLink':
      if (LINKS.has(message.url)) void shell.openExternal(message.url)
      return
    case 'window':
      if (message.action === 'minimize') appWin?.minimize()
      else if (message.action === 'maximize') {
        if (appWin?.isMaximized()) appWin.unmaximize()
        else appWin?.maximize()
      } else appWin?.hide()
      return
    case 'trayReady':
      trayReady = true
      refreshTray()
      return
    case 'trayHeight':
      trayHeight = Math.ceil(message.px)
      if (trayPanel?.isVisible()) placeTrayPanel()
      return
    case 'trayClose':
      hideTrayPanel()
      return
    case 'tray':
      hideTrayPanel()
      runTrayCommand(message.command)
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

function translateText(text: string, kind: CardKind, at: Point, via?: string): void {
  const id = openCard(kind, { status: 'translating' }, at, via)
  void translateInto(id, text, kind)
}

/**
 * Reads a snipped picture with Windows OCR into card `id`: the text, and
 * whether Windows lacked the person's language (an English engine reads
 * Cyrillic or Greek letters as Latin look-alikes); undefined when there is no
 * text, the card showing why.
 */
async function recognizeSnip(id: number, png: Buffer): Promise<{ text: string; misread: boolean } | undefined> {
  const file = path.join(app.getPath('temp'), `altype-${process.pid}-${id}.png`)
  try {
    fs.writeFileSync(file, png)
    const native = langCode(settings.native)
    // The first of the person's languages Windows reads (their own first: its engine reads Latin too), English last.
    const result = await recognize(file, [...new Set([native, ...settings.languages, 'en'].filter(Boolean))])
    if (!result.lang) return void setState(id, { status: 'no-ocr' })
    const text = paragraphsOf(result.lines)
    if (!text.trim()) return void setState(id, { status: 'empty' })
    return { text, misread: scriptFor(settings.native) !== 'Latin' && result.lang.split('-')[0]?.toLowerCase() !== native }
  } finally {
    fs.rmSync(file, { force: true })
  }
}

/** Reads a snipped picture with Windows OCR, then translates what it says. */
async function readScreenshot(png: Buffer, via?: string): Promise<void> {
  const id = openCard('screenshot', { status: 'reading' }, screen.getCursorScreenPoint(), via)
  try {
    const read = await recognizeSnip(id, png)
    if (!read) return
    const note = read.misread
      ? `Windows has no text recognition for ${settings.native}, so ${settings.native} words may come out wrong. Add it in Settings → Language.`
      : undefined
    await translateInto(id, read.text, 'screenshot', note)
  } catch (error) {
    setState(id, { status: 'failed', message: messageOf(error) })
  }
}

/** The translator's state of a text: from the language it seems to be in, into the person's own (from theirs, into English). */
function textState(text: string): Extract<CardState, { status: 'text' }> {
  const from = languageOf(text, settings.native, languageWords(), myLanguages(settings))
  return { status: 'text', text, from, to: targetFor(from, settings.native), languages: ['en', ...NATIVES], mine: myLanguages(settings), result: { status: 'none' } }
}

/** The field with the keyboard now (UI Automation), held to give the keyboard back to; undefined when Windows does not say. */
function focusedField(): unknown {
  try {
    return focusedElement()
  } catch (error) {
    console.warn('Altype: could not ask which field has the keyboard', error)
    return undefined
  }
}

function releaseField(field: unknown): void {
  if (!field) return
  try {
    release(field)
  } catch {
    // Its program may be gone.
  }
}

/** Opens the translator by the pointer with a picked text, translating it at once; `window`: where it was selected, to paste back into, `field` the field in it. */
function translateWindow(text: string, at: Point, window?: bigint, via?: string, field?: unknown): void {
  const state = { ...textState(text), canPaste: !!window }
  const id = openCard('translate', state, at, via)
  releaseField(pasteTarget?.field)
  pasteTarget = window ? { id, window, field } : undefined
  if (!window) releaseField(field)
  if (text) void translateTextCard(id, text, state.from, state.to)
}

/**
 * Paste: once Enter (pressed for it) is let go, the window the text was
 * selected in comes to the front (while the card still is, as Windows
 * allows), the field the selection was in gets the keyboard back, the card
 * goes away, and the translation is pasted over the selection through the
 * clipboard, which is put back after.
 */
async function pasteTranslation(id: number, text: string): Promise<void> {
  const target = pasteTarget
  if (!target || target.id !== id || !text) return
  pasteTarget = undefined
  const state = shown?.state
  if (state?.status === 'text') logTranslation(state.text, text, state.from, state.to)
  await keysLetGo()
  focusWindow(target.window)
  hideCard()
  await pasteInto(target.window, target.field, text)
}

/** The text pasted where the keyboard is in `window`, once it is in front, into `field` when known; the clipboard put back after. */
async function pasteInto(window: bigint, field: unknown, text: string): Promise<void> {
  await inFront(window)
  if (field) {
    try {
      // A web page in a window (VS Code's chat) takes the keyboard back a moment after.
      if (focus(field)) await new Promise(resolve => setTimeout(resolve, 80))
    } catch (error) {
      console.warn('Altype: could not give the keyboard back to the field', error)
    }
    releaseField(field)
  }
  const saved = await saveClipboard()
  await ownClipboard(async () => {
    await clipboard.writeText(text)
    await pressPaste()
  })
  setTimeout(() => void restoreClipboard(saved).catch(error => console.warn('Altype: could not put the clipboard back', error)), 500)
}

/**
 * Translate in place: the selection's translation pasted over it, no card,
 * the direction as the translator's (the person's language into English, any
 * other into theirs). A badge by the cursor says it is working. The translator
 * for the pair not downloaded yet, or the window left meanwhile: the card
 * opens instead, so nothing is lost.
 */
async function translateInPlace(text: string, at: Point, window: bigint, via?: string): Promise<void> {
  const { from, to } = textState(text)
  const missing = [from, to].some(code => code !== 'en' && translator.state(code).status !== 'ready')
  if (missing) return translateWindow(text, at, window, via)
  keyboard.say('…')
  try {
    const out = await translatePlain(text.slice(0, MAX_TEXT_CHARS), from, to, translator.translate)
    keyboard.say('')
    if (!out.trim()) return
    logTranslation(text, out, from, to)
    if (foreground().hwnd !== window) return translateWindow(text, at, window, via)
    await keysLetGo()
    await pasteInto(window, undefined, out)
  } catch (error) {
    keyboard.say('')
    tray?.displayBalloon({ title: 'Altype', content: `Could not translate: ${messageOf(error)}` })
  }
}

/** A translation kept for the Translate page's recent ones. */
function logTranslation(text: string, translation: string, from: string, to: string): void {
  translationLog.add({ text, translation, from, to })
  postApp()
}

/** Reads a snipped picture with Windows OCR and translates the text in the translator, where it can be fixed and copied. */
async function readScreenText(png: Buffer, via?: string): Promise<void> {
  const id = openCard('text', { status: 'reading' }, screen.getCursorScreenPoint(), via)
  try {
    const read = await recognizeSnip(id, png)
    if (!read) return
    const state = textState(read.text)
    setState(id, state)
    await translateTextCard(id, read.text, state.from, state.to)
  } catch (error) {
    setState(id, { status: 'failed', message: messageOf(error) })
  }
}

/** The latest translation asked of a text card: an older one, still running, is not shown. */
let textAsked = 0

/** Translates the translator's text, as it stands, from one language into another. */
async function translateTextCard(id: number, text: string, from: string, to: string): Promise<void> {
  const set = (result: TextResult) => {
    if (shown?.id === id && shown.state.status === 'text') setState(id, { ...shown.state, text, from, to, result })
  }
  const asked = ++textAsked
  const current = () => asked === textAsked
  try {
    set({ status: 'translating' })
    for (const code of [from, to]) {
      if (code === 'en' || translator.state(code).status === 'ready') continue
      await translator.prepare(code, state => {
        if (current() && state.status === 'downloading') set({ status: 'downloading', language: code, progress: state.progress, size: state.size })
      })
      if (current()) set({ status: 'translating' })
    }
    const out = await translatePlain(text.slice(0, MAX_TEXT_CHARS), from, to, translator.translate)
    if (current()) set({ status: 'ready', text: out, from, to })
  } catch (error) {
    if (current()) set({ status: 'failed', message: messageOf(error) })
  }
}

/** Opens Windows' snipping overlay; the text of the picture it puts on the clipboard is shown to listen to, or translated. */
function snip(purpose: Purpose = 'listen', via?: string): void {
  hideCard()
  snipFor = purpose
  snipVia = via
  snipSince = Date.now()
  void shell.openExternal('ms-screenclip:')
}

/** Shows a picked text by the pointer: the card to listen to, or the translator; `window`: where it was selected (`field`, the field in it), or pastes its translation over it. */
function showText(text: string, purpose: Purpose, at: Point, window?: bigint, via?: string, field?: unknown): void {
  if (purpose === 'translate') return translateWindow(text, at, window, via, field)
  releaseField(field)
  if (purpose === 'inPlace' && window) void translateInPlace(text, at, window, via)
  else translateText(text, 'selection', at, via)
}

async function useClipboard(purpose: Purpose): Promise<void> {
  const text = (await clipboard.readText()).trim()
  if (text) showText(text, purpose, screen.getCursorScreenPoint())
  else tray?.displayBalloon({ title: 'Altype', content: 'The clipboard holds no text. Select a text and copy it first.' })
}

/** A selection key: Altype presses Ctrl+C in the program in front and shows what it copies; the clipboard is put back after. */
async function useSelection(purpose: Purpose, via?: string): Promise<void> {
  const at = screen.getCursorScreenPoint()
  const window = foreground().hwnd
  // The translator's Paste gives the keyboard back to this field.
  const field = purpose === 'translate' ? focusedField() : undefined
  const saved = await saveClipboard()
  await pressCopy()
  const since = Date.now()
  releaseField(copyWanted?.field)
  copyWanted = { since, at, purpose, window, field, saved, ...(via ? { via } : {}) }
  setTimeout(() => {
    if (copyWanted?.since !== since) return
    releaseField(copyWanted.field)
    copyWanted = undefined
    void restoreClipboard(saved).catch(error => console.warn('Altype: could not put the clipboard back', error))
    tray?.displayBalloon({ title: 'Altype', content: 'Nothing was copied. Select a text, then press the shortcut.' })
  }, SELECT_WAIT_MS)
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
  setTimeout(() => read().catch(error => console.warn('Altype: could not read the clipboard', error)), SETTLE_MS)
}

function onClipboardChange(): void {
  const now = Date.now()
  if (clipboardBusy || now < ownClipboardUntil) return
  if (snipSince && now - snipSince < SNIP_WAIT_MS) {
    afterSettling(async () => {
      const png = await clipboardPng()
      if (!png || !snipSince) return
      snipSince = 0
      await (snipFor === 'translate' ? readScreenText(png, snipVia) : readScreenshot(png, snipVia))
    })
    return
  }
  if (copyWanted && now - copyWanted.since < SELECT_WAIT_MS) {
    const { at, purpose, window, field, saved, via } = copyWanted
    copyWanted = undefined
    afterSettling(async () => {
      const text = (await clipboard.readText()).trim()
      await restoreClipboard(saved)
      if (text) showText(text, purpose, at, window, via, field)
      else releaseField(field)
    })
    return
  }
  // Copying from the card itself is not a request, nor is any copy while Altype is paused.
  if (card?.isFocused() || !settings.doubleCopy || settings.paused) return
  if (!copies.change(now, ctrlHeld())) return
  const at = screen.getCursorScreenPoint()
  afterSettling(async () => {
    const text = (await clipboard.readText()).trim()
    if (text) translateText(text, 'selection', at, DOUBLE_COPY)
  })
}

function selection(purpose: Purpose, via?: string): void {
  useSelection(purpose, via).catch(error => console.warn('Altype: could not copy the selection', error))
}

/** The pause key: Altype paused, or back. */
function togglePause(): void {
  saveSettings({ paused: !settings.paused })
}

function registerShortcuts(): void {
  globalShortcut.unregisterAll()
  // A key Electron cannot hold (a double tap of Ctrl, a mouse button) is the keyboard thread's: applyKeyboard().
  const register = (accelerator: string, run: () => void): boolean => {
    if (!accelerator || !isAccelerator(accelerator)) return true
    try {
      return globalShortcut.register(accelerator, run)
    } catch {
      return false
    }
  }
  // Paused: no key but the pause key, and none is "taken".
  if (settings.paused) {
    keysOk = { snip: true, select: true, translate: true, text: true, inPlace: true, pause: register(settings.pauseKey, togglePause), window: true }
    speechKeysOk = { dictate: true, english: true, note: true, again: true }
    return
  }
  keysOk = {
    snip: register(settings.snipKey, () => snip('listen', settings.snipKey)),
    select: register(settings.selectKey, () => selection('listen', settings.selectKey)),
    translate: register(settings.translateKey, () => selection('translate', settings.translateKey)),
    text: register(settings.textKey, () => snip('translate', settings.textKey)),
    inPlace: register(settings.inPlaceKey, () => selection('inPlace', settings.inPlaceKey)),
    pause: register(settings.pauseKey, togglePause),
    window: register(settings.windowKey, () => openApp()),
  }
  // Dictate's keys mean nothing before the engine is there; then each starts and stops a phrase.
  const dictate = (mode: DictationMode, key: string) => (speech?.installed ? register(key, () => dictation.press(mode, key)) : true)
  speechKeysOk = {
    dictate: dictate('type', settings.dictateKey),
    english: dictate('english', settings.englishKey),
    note: dictate('note', settings.noteKey),
    again: speech?.installed ? register(settings.againKey, () => dictation.typeAgain()) : true,
  }
  const taken = [
    !keysOk.snip && settings.snipKey,
    !keysOk.select && settings.selectKey,
    !keysOk.translate && settings.translateKey,
    !keysOk.text && settings.textKey,
    !keysOk.inPlace && settings.inPlaceKey,
    !keysOk.pause && settings.pauseKey,
    !keysOk.window && settings.windowKey,
    !speechKeysOk.dictate && settings.dictateKey,
    !speechKeysOk.english && settings.englishKey,
    !speechKeysOk.note && settings.noteKey,
    !speechKeysOk.again && settings.againKey,
  ].filter((k): k is string => !!k)
  // The settings window shows the trouble itself; the balloon is for a start without it.
  if (taken.length > 0 && !(appWin?.isVisible() ?? false)) {
    tray?.displayBalloon({
      title: 'Altype',
      content: `${taken.map(keyLabel).join(' and ')} ${taken.length > 1 ? 'are' : 'is'} taken by another program. Choose another in the settings.`,
    })
  }
}

// ---------------------------------------------------------------- the keyboard

function applyKeyboard(): void {
  keyboardTrouble = undefined
  try {
    // Dictate's keys work only once the engine is installed, here as with Electron's shortcuts; paused, the helper keeps the pause key alone.
    keyboard.apply(speech?.installed ? settings : { ...settings, dictateKey: '', englishKey: '', noteKey: '', againKey: '' }, learned.forThread())
  } catch (error) {
    keyboardTrouble = messageOf(error)
  }
}

/** What each key types in each layout, read from Windows once. */
const tables = new Map<string, KeyTable>()
function tableFor(id: string): KeyTable | undefined {
  if (!tables.has(id)) for (const l of installedLayouts()) if (!tables.has(l.id)) tables.set(l.id, layoutTable(l.hkl))
  return tables.get(id)
}

/** The clipboard as it is, every kind of thing on it, to put back. */
async function saveClipboard(): Promise<Record<string, Blob>[]> {
  const saved: Record<string, Blob>[] = []
  for (const item of await clipboard.read()) {
    const entry: Record<string, Blob> = {}
    for (const type of item.types) {
      try {
        entry[type] = (await item.getType(type)) as Blob
      } catch {
        // A kind the clipboard announces but will not give is left behind.
      }
    }
    saved.push(entry)
  }
  return saved
}

/** Runs Altype's own use of the clipboard; the changes it makes, until a moment after, are not taken for requests. */
async function ownClipboard<T>(work: () => Promise<T>): Promise<T> {
  clipboardBusy = true
  try {
    return await work()
  } finally {
    clipboardBusy = false
    ownClipboardUntil = Date.now() + OWN_CLIPBOARD_MS
  }
}

function restoreClipboard(saved: Record<string, Blob>[]): Promise<void> {
  return ownClipboard(async () => {
    if (saved.length === 0) clipboard.clear()
    else await clipboard.write(saved.map(entry => new ClipboardItem(entry)))
  })
}

/**
 * The fix key with a selection: Altype copies it, types it again in the
 * next layout of `cycle` (the one after the layout it was typed in), pastes
 * it over the selection, selects it again (a second press goes on to the
 * next layout), switches the layout and puts the clipboard back.
 */
async function convertSelection(cycle: string[]): Promise<void> {
  const saved = await saveClipboard()
  const restore = await ownClipboard(() => convertOver(cycle))
  if (restore === 'now') return restoreClipboard(saved)
  // The program reads the clipboard when it gets Ctrl+V: the old content goes back after.
  setTimeout(() => void restoreClipboard(saved).catch(error => console.warn('Altype: could not put the clipboard back', error)), 500)
}

/** Copies the selection, pastes it converted; 'now' when nothing was pasted and the clipboard can go back at once. */
async function convertOver(cycle: string[]): Promise<'now' | 'later'> {
  const marker = `Altype ${Date.now()}`
  await clipboard.writeText(marker)
  await pressCopy()
  let text = ''
  for (let i = 0; i < 25 && !text; i++) {
    await new Promise(resolve => setTimeout(resolve, 20))
    const now = await clipboard.readText()
    if (now !== marker) text = now
  }
  const layouts = cycle.map(id => ({ id, table: tableFor(id) })).filter((l): l is { id: string; table: KeyTable } => !!l.table)
  const from = text ? sourceLayout(text, layouts) : undefined
  const to = nextLayout(cycle, from)
  const fromTable = from ? tableFor(from) : undefined
  const toTable = to ? tableFor(to) : undefined
  if (!fromTable || !toTable || !to || from === to) return 'now'
  const converted = convertText(text, fromTable, toTable)
  await clipboard.writeText(converted)
  await pressPaste()
  keyboard.switchTo(to)
  // Selected again, unless it is long or runs over lines (Shift+Left walks a line end differently in each program).
  const chars = [...converted].length
  if (chars <= RESELECT_MOST && !/[\r\n]/.test(converted)) {
    await new Promise(resolve => setTimeout(resolve, 60))
    await pressSelectBack(chars)
    // After the thread has seen those keys (another program's to it), it is told the selection is back.
    setTimeout(() => keyboard.selected(), 150)
  }
  return 'later'
}

/** Other layout switchers running now, for the settings' warning, and the other programs that watch the keyboard. */
function findRivals(): void {
  execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true }, (error, stdout) => {
    if (error) return
    const running = new Set(stdout.split(/\r?\n/).map(line => (line.split(',')[0] ?? '').replace(/"/g, '').toLowerCase()))
    const named = (list: Record<string, string>) => [
      ...new Set(
        Object.entries(list)
          .filter(([exe]) => running.has(exe))
          .map(([, name]) => name),
      ),
    ]
    const found = named(RIVALS)
    const apps = named(KEYBOARD_APPS)
    if (found.join() === rivals.join() && apps.join() === keyboardApps.join()) return
    rivals = found
    keyboardApps = apps
    postApp()
  })
}

// ---------------------------------------------------------------- tray

function keyLabel(hotkey: string): string {
  return hotkeyLabel(hotkey)
}

/** What the tray's panel shows. */
function trayView(): TrayView {
  return {
    keys: { listenCopied: settings.doubleCopy ? DOUBLE_COPY : '', snipListen: settings.snipKey, snipTranslate: settings.textKey, switch: settings.switchKey },
    autoFix: settings.autoFix,
    switchOn: settings.switchOn,
    layoutBadge: settings.layoutBadge,
    trayLayout: settings.trayLayout,
    doubleCopy: settings.doubleCopy,
    paused: settings.paused,
    speech: { installed: speech?.installed ?? false, recording: dictation?.state === 'recording', noteKey: settings.noteKey },
    translator: translator.state(langCode(settings.native)).status,
    native: settings.native,
  }
}

function refreshTray(): void {
  if (!tray) return
  tray.setToolTip(tooltip())
  void refreshTrayIcon()
  if (trayPanel && trayReady && !trayPanel.isDestroyed()) trayPanel.webContents.send('to-view', { type: 'tray', view: trayView() } satisfies ToView)
}

/** The tray's icon: the mark, faded while paused, or the layout in front on its keycap when the person wants that. */
async function refreshTrayIcon(): Promise<void> {
  const front = settings.trayLayout && !settings.paused ? frontLayout : undefined
  const icon = front ? await layoutIcon(keyboard.shortOf(front.layout).toLowerCase(), front.caps) : undefined
  tray?.setImage(icon ?? trayIcon(settings.paused))
}

/**
 * Runs in the tray panel's page: the mark's keycap (scripts/icons.mjs's
 * colours) with a layout's short name on it ("en"; underlined with Caps Lock
 * on), `size` pixels, as a PNG data URL.
 */
function drawLayoutCap(size: number, text: string, caps: boolean): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const s = size / 16
  const box = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    g.beginPath()
    g.roundRect(x * s, y * s, w * s, h * s, r * s)
    g.fillStyle = fill
    g.fill()
  }
  box(0, 0, 16, 16, 3.5, '#1c2128')
  box(1, 1, 14, 14, 2.5, '#768390')
  box(1, 1, 14, 12.5, 2.5, '#cdd9e5')
  g.fillStyle = '#1c2128'
  g.font = `800 ${size >= 32 ? 15 : 8}px "JetBrains Mono", monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text.slice(0, 2), 8 * s, 7.4 * s)
  if (caps) g.fillRect(4 * s, 11 * s, 8 * s, Math.max(1, s))
  return canvas.toDataURL('image/png')
}

const layoutIcons = new Map<string, Electron.NativeImage>()
async function layoutIcon(short: string, caps: boolean): Promise<Electron.NativeImage | undefined> {
  const key = `${short}${caps ? '^' : ''}`
  const known = layoutIcons.get(key)
  if (known) return known
  if (!trayPanel || !trayReady || trayPanel.isDestroyed()) return undefined
  try {
    const draw = (size: number) => trayPanel?.webContents.executeJavaScript(`(${drawLayoutCap.toString()})(${size}, ${JSON.stringify(short)}, ${caps})`) as Promise<string>
    const icon = nativeImage.createEmpty()
    icon.addRepresentation({ scaleFactor: 1, dataURL: await draw(16) })
    icon.addRepresentation({ scaleFactor: 2, dataURL: await draw(32) })
    layoutIcons.set(key, icon)
    return icon
  } catch (error) {
    console.warn('Altype: could not draw the layout in the tray', error)
    return undefined
  }
}

function tooltip(): string {
  if (settings.paused) return 'Altype · paused'
  const ways = [settings.doubleCopy ? 'Ctrl+C twice' : '', settings.selectKey ? keyLabel(settings.selectKey) : ''].filter(Boolean)
  const listen = ways.length ? `${ways.join(' or ')} to listen` : ''
  const translate = settings.translateKey ? `${keyLabel(settings.translateKey)} to translate` : ''
  return ['Altype', listen, translate].filter(Boolean).join(' · ')
}

/** The tray's mark, made once each: tray.png, or tray-paused.png (the same, faded) while Altype is paused. */
const trayIcons = new Map<boolean, Electron.NativeImage>()
function trayIcon(paused: boolean): Electron.NativeImage {
  let icon = trayIcons.get(paused)
  if (!icon) {
    // The 16 px mark set pixel by pixel; Electron takes the @2x file beside it on a screen at 200 %.
    icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'media', paused ? 'tray-paused.png' : 'tray.png'))
    trayIcons.set(paused, icon)
  }
  return icon
}

function createTray(): Tray {
  const t = new Tray(trayIcon(settings.paused))
  // Either button opens Altype's own panel: Windows' menu cannot take Altype's look.
  t.on('click', () => toggleTrayPanel())
  t.on('right-click', () => toggleTrayPanel())
  return t
}

/** The tray's panel: a window of Altype's own by the tray icon, made once and hidden between uses. */
function createTrayPanel(): BrowserWindow {
  const win = new BrowserWindow({
    width: TRAY_WIDTH,
    height: trayHeight,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: 'Altype',
    backgroundColor: appColor(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })
  frameWindow(win, { corner: 'round', border: borderColor() })
  win.setAlwaysOnTop(true, 'pop-up-menu')
  win.removeMenu()
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', event => event.preventDefault())
  if (!app.isPackaged) win.webContents.on('console-message', m => console.warn(`Altype tray panel: ${m.message} (${m.sourceId}:${m.lineNumber})`))
  // A click anywhere else puts it away, as a menu goes.
  win.on('blur', () => {
    if (Date.now() - trayShownAt > 200) hideTrayPanel()
  })
  win.on('closed', () => {
    trayPanel = undefined
    trayReady = false
  })
  void win.loadFile(path.join(app.getAppPath(), 'media', 'tray.html'), frameQuery)
  return win
}

function toggleTrayPanel(): void {
  if (trayPanel?.isVisible()) return hideTrayPanel()
  // The click on the icon took the focus from the open panel, which hid: that click only closes it.
  if (Date.now() - trayHiddenAt < TRAY_REOPEN_MS) return
  showTrayPanel()
}

function showTrayPanel(): void {
  if (!trayPanel || trayPanel.isDestroyed()) trayPanel = createTrayPanel()
  refreshTray()
  placeTrayPanel()
  trayShownAt = Date.now()
  trayPanel.show()
  trayPanel.focus()
  if (trayReady) trayPanel.webContents.send('to-view', { type: 'trayShown' } satisfies ToView)
}

/** By the tray icon, as tall as its content. */
function placeTrayPanel(): void {
  if (!tray || !trayPanel || trayPanel.isDestroyed()) return
  const icon = tray.getBounds()
  trayPanel.setBounds(placeByTray(icon, { width: TRAY_WIDTH, height: trayHeight }, screen.getDisplayMatching(icon).workArea))
}

function hideTrayPanel(): void {
  if (!trayPanel || trayPanel.isDestroyed() || !trayPanel.isVisible()) return
  trayHiddenAt = Date.now()
  trayPanel.hide()
}

function runTrayCommand(command: TrayCommand): void {
  switch (command) {
    case 'listenCopied':
      afterSettling(() => useClipboard('listen'))
      return
    case 'translateCopied':
      afterSettling(() => useClipboard('translate'))
      return
    case 'typeToTranslate':
      // An empty translator to type into; nothing to paste back into.
      translateWindow('', screen.getCursorScreenPoint())
      return
    case 'listenScreen':
      snip('listen')
      return
    case 'translateScreen':
      snip('translate')
      return
    case 'note':
      // A note, not typing: the panel took the focus, so there is no cursor to type at.
      dictation.press('note', settings.noteKey)
      return
    case 'transcripts':
      openApp('transcripts')
      return
    case 'settings':
      openApp('settings')
      return
    case 'open':
      openApp()
      return
    case 'quit':
      app.quit()
      return
  }
}

/**
 * For a mouse button or a launcher: `Altype --clipboard` listens to the
 * copied text and `--translate` translates it; `--snip` snips to listen,
 * `--text` to translate. True when the arguments held one.
 */
function runCommand(argv: readonly string[]): boolean {
  if (argv.includes('--clipboard')) {
    afterSettling(() => useClipboard('listen'))
    return true
  }
  if (argv.includes('--translate')) {
    afterSettling(() => useClipboard('translate'))
    return true
  }
  if (argv.includes('--snip')) {
    snip()
    return true
  }
  if (argv.includes('--text')) {
    snip('translate')
    return true
  }
  return false
}

// ---------------------------------------------------------------- start

// ---------------------------------------------------------------- the speech engine

/** Types a text in the program in front, through the clipboard, which is put back as it was. */
async function typeText(text: string): Promise<void> {
  await keysLetGo()
  const saved = await saveClipboard()
  await ownClipboard(async () => {
    await clipboard.writeText(text)
    await pressPaste()
  })
  setTimeout(() => void restoreClipboard(saved).catch(error => console.warn('Altype: could not put the clipboard back', error)), 500)
}

/**
 * Types an address into the browser window in front: Ctrl+L, the address pasted (a pasted address is not
 * completed into another one, as typed letters may be), Enter; the clipboard put back after.
 */
async function typeAddress(url: string): Promise<void> {
  const saved = await saveClipboard()
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  await ownClipboard(async () => {
    await clipboard.writeText(url)
    await pressAddressBar()
    await pause(120)
    await pressPaste()
    await pause(120)
    pressEnter()
  })
  setTimeout(() => void restoreClipboard(saved).catch(error => console.warn('Altype: could not put the clipboard back', error)), 500)
}

function balloon(title: string, content: string, click?: () => void): void {
  balloonClick = click
  tray?.displayBalloon({ title, content })
}

function setUpSpeechEngine(): void {
  speech = new SpeechHost({
    root: TEST_HOME ? path.join(TEST_HOME, 'speech') : path.join(process.env.LOCALAPPDATA ?? path.join(app.getPath('appData'), '..', 'Local'), 'Altype', 'speech'),
    userDir: userDir(),
    engineDir: unpacked('engine'),
    extensionDir: unpacked('extension'),
    sharedCache: sharedUvCache(),
    port: speechPort,
    open: url => openStream(url),
    ...(TEST_HOME ? { testHome: TEST_HOME } : {}),
    settings: () => settings,
    onChange: () => {
      postApp()
      refreshTray()
    },
  })
  dictation = new Dictation({
    page: path.join(app.getAppPath(), 'media', 'dictation.html'),
    preload: path.join(__dirname, 'preload.js'),
    background: cardColor,
    border: borderColor,
    speech,
    paste: typeText,
    toEnglish: (text, from) => translatePlain(text, from, 'en', translator.translate),
    expected: () => myLanguages(settings),
    languageOf: text => languageOf(text, settings.native, languageWords(), myLanguages(settings)),
    balloon,
    needsEngine: () => openApp('dictate'),
    openTranscript,
    onChange: () => refreshTray(),
    log: dictationLog,
    logged: () => postApp(),
    offset: () => settings.dictationBadge,
    moved: offset => saveSettings({ dictationBadge: offset }),
  })
  speech.start()
  // Windows is asked about the cards and the battery once Altype is up: it takes a second or two.
  setTimeout(() => void speech.probe().catch(error => console.warn('Altype: could not look at this computer', error)), 4000)
}

/** A page's request with an answer: the speech engine's API, a folder to pick, a transcript to save. */
async function hostCall(request: HostCall): Promise<unknown> {
  switch (request.call) {
    case 'speech':
      return speech.call(request.method, request.route, request.body)
    case 'pickFolder': {
      const options: Electron.OpenDialogOptions = { title: request.title, defaultPath: request.current || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] }
      const { canceled, filePaths } = appWin ? await dialog.showOpenDialog(appWin, options) : await dialog.showOpenDialog(options)
      return canceled ? null : (filePaths[0] ?? null)
    }
    case 'exportTranscript': {
      const safe = request.name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').trim() || 'Transcript'
      const options: Electron.SaveDialogOptions = {
        title: 'Save the transcript',
        defaultPath: path.join(app.getPath('documents'), `${safe}.${request.format}`),
        filters: [{ name: request.format.toUpperCase(), extensions: [request.format] }],
      }
      const { canceled, filePath } = appWin ? await dialog.showSaveDialog(appWin, options) : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return null
      const r = await speech.call('POST', `/transcripts/${request.id}/export`, { format: request.format, path: filePath })
      if (!r.ok) throw new Error(r.error)
      return filePath
    }
    case 'copy':
      clipboard.writeText(request.text)
      return null
    case 'openChrome': {
      const opened = await openInChrome(request.url, { front: foreground, exeOf, allowFront: allowForeground, typeAddress })
      log(`chrome: ${request.url} ${opened}`)
      return opened
    }
    case 'runningApps':
      return windowedApps().filter(exe => exe !== path.win32.basename(process.execPath).toLowerCase())
  }
}

function start(): void {
  adoptOldFolder()
  // altype.log beside the settings: the warnings, and what the windows did.
  logTo(userDir())
  const warn = console.warn.bind(console)
  console.warn = (...parts: unknown[]) => {
    warn(...parts)
    log(`warn: ${parts.map(p => (p instanceof Error ? (p.stack ?? p.message) : String(p))).join(' ')}`)
  }
  log(`start: Altype ${app.getVersion()}, Electron ${process.versions.electron}, Windows ${process.getSystemVersion()}${TEST_HOME ? ', test home' : ''}`)
  const firstRun = !fs.existsSync(settingsFile())
  settings = readSettings()
  // Only a fresh install sees the setup; a settings file from before it counts as set up (the default).
  if (firstRun) saveSettings({ setupDone: false })
  applyTheme()
  // Windows' own light or dark, switched while Altype runs (the theme "system"), repaints the windows' ground and edge.
  nativeTheme.on('updated', applyColors)
  applyLoginItem()
  setUpSpeech()
  words = new WordStore(path.join(userDir(), 'words.json'))
  dictationLog = new DictationLog(path.join(userDir(), 'dictation.json'))
  translationLog = new TranslationLog(path.join(userDir(), 'translations.json'))
  learned = new LearnStore(path.join(userDir(), 'learning.json'))
  updater = new Updater(
    {
      change: () => postApp(),
      ready: version => tray?.displayBalloon({ title: 'Altype', content: `Version ${version} is ready. It installs when Altype quits.` }),
    },
    settings.betaUpdates,
  )
  translator = createTranslator(path.join(userDir(), 'models'), unpacked('dist', 'mt-worker.js'), {
    loader: unpacked('vendor', 'bergamot', 'bergamot-translator.js'),
    wasm: unpacked('vendor', 'bergamot', 'bergamot.wasm'),
  })
  tray = createTray()
  tray.on('balloon-click', () => balloonClick?.())
  setUpSpeechEngine()
  // Made now, so the first click on the tray icon opens it at once.
  trayPanel = createTrayPanel()
  refreshTray()
  registerShortcuts()
  keyboard = new KeyboardHelper(unpacked('dist', 'kbd-worker.js'), path.join(app.getAppPath(), 'media', 'layout'), {
    keep: word => {
      learned.kept(word)
      saveSettings({ keepWords: [...settings.keepWords, word] })
    },
    // A word fixed by hand twice is fixed by itself from then on, and kept as typed no more.
    fixedByHand: word => {
      if (!learned.fixedByHand(word)) return
      if (settings.keepWords.includes(word.word)) saveSettings({ keepWords: settings.keepWords.filter(w => w !== word.word) })
      else applyKeyboard()
      postApp()
    },
    tally: (hash, count, word) => {
      if (!learned.tally(hash, count, word)) return
      applyKeyboard()
      postApp()
    },
    selection: cycle => void convertSelection(cycle).catch(error => console.warn('Altype: could not convert the selection', error)),
    hotkey: action => {
      if (action === 'pause') return togglePause()
      // Paused, the thread keeps the pause key alone; a key on its way meanwhile does nothing.
      if (settings.paused) return
      if (action === 'dictate') dictation.press('type', settings.dictateKey)
      else if (action === 'english') dictation.press('english', settings.englishKey)
      else if (action === 'note') dictation.press('note', settings.noteKey)
      else if (action === 'again') dictation.typeAgain()
      else if (action === 'select') selection('listen', settings.selectKey)
      else if (action === 'translate') selection('translate', settings.translateKey)
      else if (action === 'inPlace') selection('inPlace', settings.inPlaceKey)
      else if (action === 'text') snip('translate', settings.textKey)
      else if (action === 'window') openApp()
      else snip('listen', settings.snipKey)
    },
    app: (exe, elevated) => {
      lastApp = exe
      if (elevated) elevatedApp = exe
      postApp()
    },
    layout: (layout, caps) => {
      if (!settings.trayLayout) return
      frontLayout = { layout, caps }
      void refreshTrayIcon()
    },
    foreignKeys: () => {
      foreignKeys = true
      findRivals()
      postApp()
    },
    failed: message => {
      keyboardTrouble = message
      console.warn(`Altype keyboard: ${message}`)
      postApp()
    },
  })
  applyKeyboard()
  card = createCard()
  ipcMain.on('to-host', (_event, message: ToHost) => onMessage(message))
  ipcMain.handle('host-call', (_event, request: HostCall) => hostCall(request))
  try {
    stopWatching = watchClipboard(card, onClipboardChange)
  } catch (error) {
    tray.displayBalloon({ title: 'Altype', content: `Ctrl+C twice will not work: ${messageOf(error)}. Use the tray menu.` })
  }
  void sendHostVoices()
  updater.start()
  // The first start opens the window on "How to use".
  if (firstRun) openApp('home')
  runCommand(process.argv)
}

if (!theOnlyOne) {
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
  // The card is hidden, never closed: Altype keeps running in the tray.
  app.on('window-all-closed', () => undefined)
  // Each part is put away on its own: one that fails must not keep the app from quitting.
  app.on('will-quit', () => {
    const steps: [string, () => void][] = [
      ['shortcuts', () => globalShortcut.unregisterAll()],
      ['speech', () => speech?.dispose()],
      ['dictation', () => dictation?.dispose()],
      ['updater', () => updater?.dispose()],
      ['clipboard', () => stopWatching?.()],
      ['voice', () => natural?.dispose()],
      ['translator', () => translator?.dispose()],
      ['keyboard', () => keyboard?.dispose()],
      ['learning', () => learned?.flush()],
    ]
    for (const [name, step] of steps) {
      try {
        step()
      } catch (error) {
        console.warn(`Altype: could not put away the ${name}`, error)
      }
    }
  })
  void app.whenReady().then(start)
}
