// Krya's main process. It lives in the tray and waits for a text:
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
// %APPDATA%\Krya\ (moved over from Altype's, 2Talker's or tu-talk's folder, once: oldfolder.ts)
//   settings.json   see settings.ts
//   words.json      the word notebook (words.ts)
//   dictation.json  the phrases dictated lately, 30 days at most (dictationlog.ts)
//   translations.json  the texts translated lately, 30 days at most (translationlog.ts)
//   learning.json   what the layout fixer learned from the person's typing (learning.ts)
//   voice\          the natural voice, downloaded on request
//   dict\           word dictionaries for languages other than Russian
//   models\         the translator's models, one folder per language pair
//   speech.json     the speech engine's settings (engine/settings.py), speech.log
// %LOCALAPPDATA%\Krya\ (moved over from Altype's, once; a part that could not move is used there)
// %LOCALAPPDATA%\Krya\speech\   the speech engine's Python, packages and models
// %LOCALAPPDATA%\Krya\translate\   llama.cpp and the Gemma 4 models (Accurate, Most accurate)

import * as fs from 'node:fs'
import * as path from 'node:path'

import { execFile, execFileSync } from 'node:child_process'

import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, screen, session, shell, Tray, type Rectangle } from 'electron'

import { backupSummary, makeBackup, readBackup, type BackupRead } from './backup'
import { callAllowed, messageAllowed, openable, pageOf, patchAllowed } from './bridge'
import { createChecker, type Checker } from './checker'
import { openInChrome } from './chrome'
import { DoubleCopy } from './clipboard'
import { ClipboardGuard } from './clipguard'
import { Dictation } from './dictation'
import { DictationLog } from './dictationlog'
import { DOWNLOADABLE, DictionaryStore } from './dictstore'
import { openStream } from './download'
import { frameWindow, WIN11 } from './dwm'
import { createTranslator, NATIVES } from './engine'
import { translationAdvice } from './hardware'
import { hotkeyLabel, isAccelerator } from './hotkey'
import { FIX_LANGUAGES, KeyboardHelper, keyboardLayouts } from './keyboard'
import { driveOf, freeMb, loadModelSpeeds, loadVoiceSpeed, median, nextModelSpeed, nextVoiceSpeed, saveModelSpeeds, saveVoiceSpeed, type ModelSpeeds, type VoiceSpeed } from './device'
import { defaultNative, findLanguage, langCode, scriptFor } from './languages'
import { convertText, nextLayout, sourceLayout, type KeyTable } from './layoutfix'
import { LearnStore } from './learning'
import { lookup, type Dictionary } from './lemma'
import { LlamaServer } from './llama'
import { createLlmFiles, llmPaths, type LlmFiles } from './llmfiles'
import { createLlmTranslators, type LlmTranslators } from './llmtranslator'
import { MistakeStore } from './mistakes'
import { log, logTo } from './log'
import { systemVoiceName, type NaturalState } from './natural'
import { recognize } from './ocr'
import { pickLines } from './ocrpick'
import { adoptLocalFolder, adoptOldFolders, freeFolder, hasToMove, leftIn, moveDownloads, partDir, removeOldUpdaterCaches, type LeftPart, type Warn } from './oldfolder'
import { paragraphsOf } from './ocrtext'
import { placeByTray, placeNear, resize, type Point } from './placement'
import type { AppTab, AppView, CardKind, CardState, CheckResult, DictationMode, DictionaryStatus, GlossMissing, HostCall, HostVoice, StorageId, StoragePart, StorageView, TextResult, ToHost, ToView, TranslationState, TrayCommand, TrayView, ViewConfig } from './protocol'
import { englishHtml, textOutHtml, translationHtml } from './render'
import { addKept, CARD_WIDTH, DEFAULTS, keptForm, LEVEL_NAMES, myLanguages, normalize, TARGET, type LlmModel, type Settings } from './settings'
import { Speaker, listHostVoices } from './speech'
import { SpeechHost } from './speechhost'
import { SPEECH_PORT } from './speechservice'
import { markAway, measureParts, type Place } from './storage'
import { NaturalSpeaker } from './synth'
import { system32 } from './system32'
import { englishReady, languageOf, plainText, splitText, targetFor, translateLines, translatePairs, translatePlain, type LanguageWords } from './translate'
import { TranslationLog } from './translationlog'
import type { Translator } from './translator'
import manifest from './voice-manifest.json'
import { VoiceStore, type VoiceManifest } from './voicestore'
import { wordDiff } from './worddiff'
import { focus, focusedElement, release, selectedText } from './uia'
import { allowForeground, ctrlHeld, handleOf, inFront, keysLetGo, pressAddressBar, pressCopy, pressEnter, pressPaste, pressSelectBack, watchClipboard, watchRendering } from './winclip'
import {
  privateCopy,
  readers as clipboardReaders,
  render as renderClipboardText,
  renderAll as renderAllClipboardText,
  restore as restoreClipboardSnapshot,
  sequence as clipboardSequence,
  snapshot as clipboardSnapshot,
  writeText as writeClipboardText,
  type ClipboardSnapshot,
} from './winclipboard'
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
/** How long after Krya presses Ctrl+C the program's copy may come: a busy VS Code (Claude writing an answer) takes over half a second. */
const COPY_WAIT_MS = 2000
/** No copy by then: the field's selection is read through UI Automation instead (Claude's question box in VS Code never answers Ctrl+C). */
const UIA_WAIT_MS = 600
/** How long after Krya's own write to the clipboard a change is still taken for that write. */
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
const TRAY_WIDTH = 360
const TRAY_REOPEN_MS = 300
/** Ctrl+C pressed twice, as a card's header draws the key that called it. */
const DOUBLE_COPY = 'Control+C*2'
/** The settings that are keys of actions. */
const ACTION_KEYS: readonly (keyof Settings)[] = ['selectKey', 'snipKey', 'translateKey', 'textKey', 'inPlaceKey', 'checkKey', 'typeKey', 'typeCheckKey', 'switchKey', 'fixKey', 'pauseKey', 'windowKey']
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
  'https://github.com/ikstro/krya',
  'https://github.com/ikstro/krya/releases',
  'https://github.com/ikstro/krya/blob/main/NOTICE',
  // The steps to the speakers' model: an account, the model's terms, a Read token.
  'https://huggingface.co/join',
  'https://huggingface.co/pyannote/speaker-diarization-community-1',
  'https://huggingface.co/settings/tokens',
])

/** The settings that are Dictate's keys: registered only once the speech engine is installed. */
const DICTATION_KEYS: readonly (keyof Settings)[] = ['dictateKey', 'englishKey', 'noteKey', 'againKey', 'practiceKey']

// One Krya at a time, whichever folder it keeps its things in: the lock is taken on Krya's own
// folder first, before a test run moves to its own. A second copy (another start, `npm start`, a test
// run) hands its arguments to the first and quits; the first opens its window.
const theOnlyOne = app.requestSingleInstanceLock()
// A test run (KRYA_TEST_HOME; ALTYPE_TEST_HOME, the old name, still read) keeps to its own folders and port; the installed Krya is quit first.
const TEST_HOME = process.env.KRYA_TEST_HOME || process.env.ALTYPE_TEST_HOME || undefined
if (TEST_HOME) app.setPath('userData', TEST_HOME)
const speechPort = TEST_HOME ? Number(process.env.KRYA_TEST_PORT || process.env.ALTYPE_TEST_PORT) || 8797 : SPEECH_PORT

const userDir = () => app.getPath('userData')
const localAppData = () => process.env.LOCALAPPDATA ?? path.join(app.getPath('appData'), '..', 'Local')
/** %LOCALAPPDATA%\Krya: what is big and downloaded (the speech engine, the translation models), never roamed. */
const localDir = () => TEST_HOME ?? path.join(localAppData(), 'Krya')
/** %LOCALAPPDATA%\Altype, the old name's folder: a part that could not move out of it is used there (oldfolder.ts adoptLocalFolder). */
const oldLocalDir = () => path.join(localAppData(), 'Altype')
const oldLocalDirs = () => (TEST_HOME ? [] : [oldLocalDir()])
/** A part of localDir (speech, translate), or the old folder's when it is still there. */
const localPart = (name: string) => partDir(name, localDir(), ...oldLocalDirs())
/** A download's folder (the Firefox models, the voice, the word meanings): in localDir, beside the rest (oldfolder.ts moveDownloads); else where its move left it. */
const downloads = (name: string) => partDir(name, localDir(), ...oldLocalDirs(), userDir())
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
/** Krya is using the clipboard itself (converting a selection, pasting, putting it back): its changes are no requests. */
let clipboardBusy = false
/** What the person had on the clipboard, kept while Krya borrows it and put back after; the card's window owns Krya's writes. */
const clipGuard = new ClipboardGuard<ClipboardSnapshot>({
  sequence: clipboardSequence,
  snapshot: () => clipboardSnapshot(clipboardOwner()),
  restore: saved => restoreClipboardSnapshot(clipboardOwner(), saved),
  writeText: (text, paste) => writeClipboardText(clipboardOwner(), text, paste),
})
function clipboardOwner(): bigint {
  return card && !card.isDestroyed() ? handleOf(card) : 0n
}
/** Its last write is announced a moment later, until then. */
let ownClipboardUntil = 0
let stopWatching: (() => void) | undefined
let hostVoices: HostVoice[] | undefined
const copies = new DoubleCopy()
let appWin: BrowserWindow | undefined
let appReady = false
let quitting = false
let keysOk = { snip: true, select: true, translate: true, text: true, inPlace: true, check: true, type: true, typeCheck: true, pause: true, window: true }
let speechKeysOk = { dictate: true, note: true, english: true, again: true, practice: true }
let speech: SpeechHost
let dictation: Dictation
/** What a click on the tray's balloon does, for the balloon shown last. */
let balloonClick: (() => void) | undefined
let keyboard: KeyboardHelper
let keyboardTrouble: string | undefined
let lastApp: string | undefined
/** A program run as administrator was in front lately: Windows keeps its keys from Krya's hooks. */
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
let trayHeight = 600
/** The last word fixed by itself, as typed and as fixed, for the tray's "Keep a word as typed…"; kept in memory only. */
let lastAutoFix: { word: string; fixed: string } | undefined
let trayShownAt = 0
let trayHiddenAt = 0
/** The Transcribe page records from the microphone (its `micRecording` message): the tray shows the red dot. */
let micRecording = false
/**
 * A selection key pressed Ctrl+C: the next copy is the selection, shown by
 * the pointer to listen to or translate, and the window it was selected in
 * (the clipboard as it was is kept by `clipGuard`).
 */
let copyWanted: { since: number; at: Point; purpose: Purpose; window: bigint; field: unknown; via?: string; exe: string } | undefined
/** A selection key found nothing copied: a copy that still comes this soon after, with Ctrl up (not the person's own Ctrl+C), is the program's late answer and is taken back. */
let lateCopyUntil = 0
const LATE_COPY_MS = 1500
/**
 * The translator open on a selection: the window to paste its translation
 * into, and the field the selection was in (UI Automation's element), to give
 * the keyboard back to: VS Code's chat, brought back to the front, does not
 * take it back by itself.
 */
let pasteTarget: { id: number; window: bigint; field: unknown; after?: string } | undefined
/** The window in front when the card opened, which gets the keyboard back when the card is closed (Esc, ✕). */
let cameFrom: bigint | undefined
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
/** The most common English words, for the card's dotted lines; read once. */
let common: string[] | undefined

// ---------------------------------------------------------------- settings

function systemNative(): string {
  return defaultNative([app.getLocale(), ...app.getPreferredSystemLanguages()], TARGET)
}

/**
 * The app was called Altype until 0.11, 2Talker and tu-talk before: its things move over once,
 * %APPDATA%'s item by item, %LOCALAPPDATA%'s whole when it can (the speech engine's Python set right
 * for its new place). A test run keeps to its own folder and moves nothing. Returns what moved, for the log.
 */
function adoptOldFolder(): Moved {
  if (TEST_HOME) return { moved: [], stopped: [], left: [] }
  const warn = (message: string, error: unknown) => console.warn(message, error)
  const moved = adoptOldFolders(app.getPath('appData'), userDir(), warn)
  const local = moveLocalFolder()
  if (app.isPackaged) removeOldUpdaterCaches(localAppData(), warn)
  return { ...local, moved: [...moved, ...local.moved] }
}

/** What a move from the old folders did: what moved, the programs stopped to let go of its files, what stayed and why. */
type Moved = { moved: string[]; stopped: string[]; left: LeftPart[] }

/**
 * %LOCALAPPDATA%\Altype into Krya's folder (oldfolder.ts adoptLocalFolder), and the downloads from %APPDATA%\Krya
 * (moveDownloads). Programs run from inside the old folder (the speech engine's Python, llama-server, left by Altype
 * or a run from source) keep its files in use, so they are stopped first, only while it holds something to move.
 */
function moveLocalFolder(): Moved {
  const old = oldLocalDir()
  const errors = new Map<string, unknown>()
  const warn: Warn = (message, error, from) => {
    console.warn(message, error)
    if (from) errors.set(path.basename(from), error)
  }
  const freed = hasToMove(old, localDir()) ? freeFolder(old, undefined, warn) : { stopped: [], holding: [] }
  const moved = adoptLocalFolder(old, localDir(), warn).map(name => `local/${name}`)
  moved.push(...moveDownloads(userDir(), localDir(), warn).map(name => `downloads/${name}`))
  const left = leftIn(old, localDir(), errors, freed.holding)
  leftOld = left
  return { moved, stopped: freed.stopped.map(p => `${p.name} (${p.pid})`), left }
}

/** What the last move left in the old Altype folder and why: the Storage page says it beside Move to Krya. */
let leftOld: LeftPart[] = []

/** The log's lines for a move: what was stopped for it, what stayed in the old folder and why. */
function logMoved(r: Moved): void {
  if (r.moved.length) log(`moved over from the old folders: ${r.moved.join(', ')}`)
  if (r.stopped.length) log(`stopped to free ${oldLocalDir()}: ${r.stopped.join(', ')}`)
  if (r.left.length) log(`left in ${oldLocalDir()}: ${r.left.map(p => `${p.name} (${p.why})`).join(', ')}`)
}

/** The old name's program still running (Altype.exe, an older install): its folders are in use, so this start gives way. */
function oldAppRunning(): boolean {
  if (TEST_HOME || !fs.existsSync(path.join(app.getPath('appData'), 'Altype', 'settings.json'))) return false
  try {
    const out = execFileSync(system32('tasklist.exe'), ['/FI', 'IMAGENAME eq Altype.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true, timeout: 5000 })
    return /"Altype\.exe"/i.test(out)
  } catch {
    return false
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
    console.warn('Krya: could not save the settings', error)
  }
  if ('startWithWindows' in patch) applyLoginItem()
  // A key may be Electron's or the keyboard thread's (hotkey.ts isAccelerator): both learn of any change.
  if ([...ACTION_KEYS, ...DICTATION_KEYS, 'paused'].some(k => k in patch)) registerShortcuts()
  if ([...ACTION_KEYS, ...DICTATION_KEYS, ...KEYBOARD_SETTINGS].some(k => k in patch)) applyKeyboard()
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
  // The dictation badge needs nothing: its page draws its ground and edge, and follows the theme itself.
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
    root: downloads('voice'),
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
    cacheDir: downloads('dict'),
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

/** How fast each local model translates and checks on this computer, measured on real use. */
let modelSpeeds: ModelSpeeds = {}
/** Shown once a few were timed. */
const LEVEL_SURE_AFTER = 3

function modelTimed(model: LlmModel, timed: { sentence?: number; text?: number; start?: number }): void {
  modelSpeeds = { ...modelSpeeds, [model]: nextModelSpeed(modelSpeeds[model], timed) }
  saveModelSpeeds(deviceFile(), modelSpeeds)
  postApp()
}

/** Each model's measured seconds (a sentence, a text checked, loading it), each once timed a few times. */
function modelSpeedView(): AppView['modelSpeed'] {
  const sure = (list: number[] | undefined) => (list && list.length >= LEVEL_SURE_AFTER ? median(list) : undefined)
  const out: AppView['modelSpeed'] = {}
  for (const model of ['accurate', 'most'] as const) {
    const s = modelSpeeds[model]
    const view = { sentence: sure(s?.sentence), text: sure(s?.text), start: sure(s?.start) }
    const known = Object.fromEntries(Object.entries(view).filter(([, n]) => n !== undefined))
    if (Object.keys(known).length) out[model] = known
  }
  return out
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

/** A translator's models for the person's language downloaded ahead of their first use; the window follows it at most four times a second. */
function prepareTranslator(t: Translator): void {
  let last = 0
  t
    .prepare(langCode(settings.native), () => {
      if (Date.now() - last < 250) return
      last = Date.now()
      postApp()
    })
    .catch(error => console.warn('Krya: the translator did not download', error))
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
    defaultPath: path.join(app.getPath('documents'), 'Krya words.txt'),
    filters: [{ name: 'Text for Anki', extensions: ['txt'] }],
  })
  if (filePath) fs.writeFileSync(filePath, ankiTsv(words.list()) + '\n', 'utf8')
}

/** A backup (backup.ts): the settings and everything the person made here, one file to keep or to take to another computer. */
async function exportBackup(): Promise<void> {
  const day = new Date().toISOString().slice(0, 10)
  const options: Electron.SaveDialogOptions = {
    title: 'Save a backup',
    defaultPath: path.join(app.getPath('documents'), `Krya backup ${day}.json`),
    filters: [{ name: 'Krya backup', extensions: ['json'] }],
  }
  const { filePath } = appWin ? await dialog.showSaveDialog(appWin, options) : await dialog.showSaveDialog(options)
  if (!filePath) return
  learned.flush()
  const backup = makeBackup(app.getVersion(), new Date(), settings, {
    words: words.list().reverse(),
    mistakes: mistakes.list(),
    learned: learned.lists(),
    translations: translationLog.list(),
    dictation: dictationLog.list(),
  })
  fs.writeFileSync(filePath, JSON.stringify(backup, null, 2) + '\n', 'utf8')
}

/**
 * A backup the person picks, after a question that says what it holds: its
 * settings replace these (this computer's place for the dictation badge
 * stays), its words, mistakes, learned words and history are added to what is
 * here. A settings file from an older Krya is its settings alone.
 */
async function importBackup(): Promise<void> {
  const options: Electron.OpenDialogOptions = { title: 'Open a backup', defaultPath: app.getPath('documents'), filters: [{ name: 'Krya backup', extensions: ['json'] }], properties: ['openFile'] }
  const { canceled, filePaths } = appWin ? await dialog.showOpenDialog(appWin, options) : await dialog.showOpenDialog(options)
  const file = filePaths[0]
  if (canceled || !file) return
  let read: BackupRead
  try {
    read = readBackup(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (error) {
    void dialog.showMessageBox({ type: 'warning', title: 'Krya', message: 'This backup could not be read', detail: messageOf(error) })
    return
  }
  const ask: Electron.MessageBoxOptions = {
    type: 'question',
    title: 'Krya',
    message: 'Import this backup?',
    detail: `It holds ${backupSummary(read)}. Your settings become the backup's; its words, mistakes and history are added to yours, nothing of yours is removed.`,
    buttons: ['Import', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  }
  const { response } = appWin ? await dialog.showMessageBox(appWin, ask) : await dialog.showMessageBox(ask)
  if (response !== 0) return
  words.merge(read.words)
  mistakes.merge(read.mistakes)
  learned.merge(read.learned)
  translationLog.merge(read.translations)
  dictationLog.merge(read.dictation)
  // All of the settings saved: the keys and the keyboard are applied again, the learned words with them.
  saveSettings(normalize({ ...settings, ...read.settings, dictationBadge: settings.dictationBadge, setupDone: true }, settings.native))
  postApp()
}

/** All settings back to how they came, after a question; the person's language, the setup done and what Krya learned stay. */
async function resetSettings(): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: 'Krya',
    message: 'Reset all settings?',
    detail: 'Keys, switches and lists go back to how they came. Your language, words, transcripts and what Krya learned from your typing stay.',
    buttons: ['Reset', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  }
  const { response } = appWin ? await dialog.showMessageBox(appWin, options) : await dialog.showMessageBox(options)
  if (response !== 0) return
  saveSettings({ ...DEFAULTS, native: settings.native, languages: settings.languages, setupDone: true, introSeen: true })
}

/** Every key back to how it came, after a question: the actions', the layouts' own, Ctrl+C twice and the keys turned off. */
async function resetKeys(): Promise<void> {
  const options: Electron.MessageBoxOptions = {
    type: 'question',
    title: 'Krya',
    message: 'Reset all keys?',
    detail: 'Every shortcut goes back to how it came: Ctrl+Alt+S, Ctrl+Alt+T, Ctrl+Alt+D, Ctrl+Alt+N and Ctrl+C twice; the others are cleared. Nothing else changes.',
    buttons: ['Reset keys', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
  }
  const { response } = appWin ? await dialog.showMessageBox(appWin, options) : await dialog.showMessageBox(options)
  if (response !== 0) return
  const keys = Object.fromEntries([...ACTION_KEYS, ...DICTATION_KEYS].map(k => [k, DEFAULTS[k]]))
  saveSettings({ ...keys, layoutKeys: {}, doubleCopy: true, switchOn: true, fixKeyOn: true })
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
    title: 'Krya',
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

/** What a text is picked for: the card that reads its English aloud, the translator, its translation pasted over it, or its English checked. */
type Purpose = 'listen' | 'translate' | 'inPlace' | 'check'

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

/** The word lists of the person's languages, read once each: a line read off the screen is judged by them. */
const ocrLists = new Map<string, ReadonlySet<string>>()
function ocrKnown(): (word: string) => boolean {
  const lists = myLanguages(settings).map(code => {
    if (code === 'en') return languageWords().english
    let list = ocrLists.get(code)
    if (!list) {
      list = languageWords().common[code] ?? new Set<string>()
      if (FIX_LANGUAGES.includes(code)) {
        try {
          list = new Set(fs.readFileSync(path.join(app.getAppPath(), 'media', 'layout', `${code}.txt`), 'utf8').split('\n'))
        } catch {
          // Its common words stay.
        }
      }
      ocrLists.set(code, list)
    }
    return list
  })
  return word => lists.some(list => list.has(word))
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

/** esbuild.mjs: when this copy was built, and from which commit. */
declare const KRYA_BUILD: { at: string; commit: string; changed: boolean }

/** "30 Oct, 07:12 (ff17ba8, changed)": a run from source tells today's build from yesterday's. */
function buildText(): string {
  const at = new Date(KRYA_BUILD.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  return KRYA_BUILD.commit ? `${at} (${KRYA_BUILD.commit}${KRYA_BUILD.changed ? ', changed' : ''})` : at
}

// ---------------------------------------------------------------- storage

/** What Krya keeps, measured once the Storage page was opened (storage.ts); again after a removal. */
let storage: StorageView | undefined
let measuring = false
let measureAgain = false

function storagePlaces(): Place[] {
  const translate = localPart('translate')
  const models = llmPaths(translate)
  const transcripts = speech?.service.health?.dataDir
  return [
    { id: 'fast', path: downloads('models') },
    { id: 'voice', path: downloads('voice') },
    { id: 'dict', path: downloads('dict') },
    { id: 'accurate', path: models.model('accurate') },
    { id: 'most', path: models.model('most') },
    { id: 'unused', path: path.join(translate, 'models'), only: llmFiles.unused() },
    { id: 'llama', path: path.join(translate, 'engine') },
    { id: 'speech', path: localPart('speech') },
    { id: 'yours', path: userDir() },
    ...(transcripts ? [{ id: 'transcripts' as const, path: transcripts }] : []),
  ]
}

/** Walks the parts (a few seconds for the speech engine's thousands of files); a call meanwhile measures once more after. */
function measureStorage(): void {
  if (measuring) {
    measureAgain = true
    return
  }
  measuring = true
  const root = localDir()
  storage = { measuring: true, root, drive: driveOf(root), freeMb: storage?.freeMb ?? 0, parts: storage?.parts ?? [] }
  postApp()
  measureParts(storagePlaces())
    .then(measured => {
      const parts = markAway(measured, root, DOWNLOADED)
      storage = { measuring: false, root, drive: driveOf(root), freeMb: freeMb(root), parts, ...oldFolderView(parts) }
    })
    .catch(error => console.warn('Krya: could not measure the storage', error))
    .finally(() => {
      measuring = false
      if (storage?.measuring) storage = { ...storage, measuring: false }
      postApp()
      if (measureAgain) {
        measureAgain = false
        measureStorage()
      }
    })
}

/** Measured again after a removal, when the page has been opened. */
const remeasure = () => (storage ? measureStorage() : postApp())

/** Krya's downloads, which belong in its one folder; the person's own things live elsewhere. */
const DOWNLOADED: readonly StorageId[] = ['fast', 'voice', 'dict', 'accurate', 'most', 'unused', 'llama', 'speech']
/** Move to Krya is under way: the page shows it, and a second press waits. */
let movingToKrya = false

/** A download used from outside Krya's folder: the old one's place, and why the last move left it there. */
function oldFolderView(parts: readonly StoragePart[]): Pick<StorageView, 'old'> {
  if (!parts.some(p => p.away)) return {}
  const why = [...new Set(leftOld.filter(p => p.why !== 'Krya has its own').map(p => p.why))].join('; ')
  return { old: { dir: oldLocalDir(), moving: movingToKrya, ...(why ? { why } : {}) } }
}

/**
 * The Storage page's Move to Krya: what still lives in the old Altype folder goes into Krya's. The speech engine,
 * the model's server, the voice and Firefox's translator let go of their files first; the programs run from the
 * old folder are stopped (moveLocalFolder). Each part keeps its place from Krya's start, so Krya starts again on
 * the Storage page once anything moved; when nothing could, the engine comes back and the page says why.
 */
async function moveToKrya(): Promise<void> {
  if (movingToKrya || TEST_HOME) return
  movingToKrya = true
  if (storage) storage = { ...storage, ...oldFolderView(storage.parts) }
  postApp()
  speech.service.stop()
  await llmFiles.server.stop()
  natural.dispose()
  translator.dispose()
  // The page's "moving" is drawn before the move holds the main process for a second or two.
  await new Promise(resolve => setTimeout(resolve, 300))
  const r = moveLocalFolder()
  log('move to Krya: pressed on the Storage page')
  logMoved(r)
  if (r.moved.length) {
    app.relaunch({ args: [...process.argv.slice(1).filter(a => a !== '--storage'), '--storage'] })
    app.quit()
    return
  }
  movingToKrya = false
  speech.start()
  measureStorage()
}

/** A download of Krya's own deleted from the Storage page; each downloads again when it is wanted next. */
function removeDownload(part: 'fast' | 'voice' | 'dict' | 'unused'): void {
  switch (part) {
    case 'fast':
      if (translator.state(langCode(settings.native)).status === 'downloading') return
      translator.dispose()
      fs.rmSync(downloads('models'), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
      return
    case 'voice':
      natural.dispose()
      voiceStore.remove()
      return
    case 'dict':
      dictionaries.clear()
      return
    case 'unused':
      llmFiles.removeUnused()
      return
  }
}

function appView(): AppView {
  return {
    settings,
    version: app.getVersion(),
    build: buildText(),
    dev: !app.isPackaged,
    natural: naturalState(),
    hostVoices: hostVoices ?? [],
    languages: NATIVES.map(code => findLanguage(code))
      .filter(l => l !== undefined)
      .map(l => ({ name: l.name, native: l.native })),
    words: words.list(),
    keysOk,
    translator: activeTranslator().state(langCode(settings.native)).status,
    translatorState: translator.state(langCode(settings.native)),
    translation: {
      fast: translator.state(langCode(settings.native)),
      accurate: llm.accurate.state(langCode(settings.native)),
      most: llm.most.state(langCode(settings.native)),
    },
    models: { accurate: llmFiles.state('accurate'), most: llmFiles.state('most') },
    modelSpeed: modelSpeedView(),
    dictionary: { status: dictionaryStatus() },
    mistakes: mistakes.list(),
    ...(storage ? { storage } : {}),
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
    width: 960,
    height: 700,
    minWidth: 560,
    minHeight: 440,
    show: false,
    // The page draws its own sidebar and bar (the mark, the places, minimize and close); the edges still resize.
    frame: false,
    title: 'Krya',
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
    win.webContents.on('console-message', m => console.warn(`Krya app window: ${m.message} (${m.sourceId}:${m.lineNumber})`))
    win.webContents.on('did-fail-load', (_event, code, description) => console.warn(`Krya app window did not load: ${code} ${description}`))
  }
  // Closing hides: Krya lives in the tray.
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

/** Shows the app window, on `tab` if one is named; a window that was closed opens on Home. */
function openApp(tab?: AppTab): void {
  if (!appWin || appWin.isDestroyed()) appWin = createAppWindow()
  findRivals()
  if (!tab && !appWin.isVisible()) tab = 'home'
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
    card: { ...shown, target: TARGET, native: settings.native, level: settings.translationLevel, autoRead: settings.autoRead },
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
  // A card open already (pinned) keeps the window it came from.
  const front = foreground().hwnd
  const ours = [win, trayPanel].some(w => w && !w.isDestroyed() && handleOf(w) === front)
  if (!ours && front !== 0n) cameFrom = front
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
  // A checked text with a mistake goes into Mistakes once, as the card closes.
  if (state?.status === 'check' && state.result.status === 'ready' && card?.isVisible()) logMistake(state.result)
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
 * Esc or ✕: the card goes and the window it was called from gets the keyboard
 * back (hidden alone, the card leaves Windows to bring up a window of its
 * choosing), brought to the front while the card still is, as Windows allows;
 * a translator's field gets it too (VS Code's chat does not take it back by
 * itself). A click elsewhere only hides the card: that window was chosen.
 */
async function closeCard(): Promise<void> {
  const target = shown && pasteTarget?.id === shown.id ? pasteTarget : undefined
  const back = target?.window ?? cameFrom
  cameFrom = undefined
  pasteTarget = undefined
  if (back && card?.isFocused()) focusWindow(back)
  hideCard()
  if (!target?.field) return
  try {
    await inFront(target.window)
    focus(target.field)
  } finally {
    releaseField(target.field)
  }
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
    case 'exportBackup':
      exportBackup().catch(error => console.warn('Krya: could not save the backup', error))
      return
    case 'importBackup':
      importBackup().catch(error => console.warn('Krya: could not import the backup', error))
      return
    case 'resetSettings':
      resetSettings().catch(error => console.warn('Krya: could not reset the settings', error))
      return
    case 'resetKeys':
      resetKeys().catch(error => console.warn('Krya: could not reset the keys', error))
      return
    case 'installSpeech':
      speech.install(message.parts, message.models).then(
        () => (registerShortcuts(), applyKeyboard()),
        error => console.warn('Krya: the speech engine did not install', error),
      )
      return
    case 'prepareTranslator':
      prepareTranslator(translator)
      return
    case 'translationLevel':
      // A model picked here is the one model: Check uses it too.
      saveSettings(message.level === 'fast' ? { translationLevel: 'fast' } : { translationLevel: message.level, model: message.level })
      prepareTranslator(activeTranslator())
      return
    case 'useModel':
      saveSettings({ model: message.model })
      prepareModel()
      return
    case 'removeModel':
      if (settings.translationLevel === message.model) saveSettings({ translationLevel: 'fast' })
      llmFiles
        .remove(message.model)
        .catch(error => console.warn('Krya: could not remove the model', error))
        .finally(remeasure)
      return
    case 'forgetMistake':
      mistakes.remove(message.at)
      postApp()
      return
    case 'clearMistakes':
      mistakes.clear()
      postApp()
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
    case 'removeSpeechModel':
      void speech
        .removeModel(message.model)
        .catch(error => console.warn('Krya: could not remove the speech model', error))
        .then(() => (postApp(), remeasure()))
      return
    case 'removeSpeech':
      void speech.remove().then(() => (registerShortcuts(), applyKeyboard(), remeasure()))
      return
    case 'storage':
      measureStorage()
      return
    case 'moveToKrya':
      void moveToKrya().catch(error => {
        movingToKrya = false
        leftOld = [{ name: 'Altype', why: messageOf(error) }]
        console.warn('Krya: could not move the old folder', error)
        remeasure()
      })
      return
    case 'removeDownload':
      try {
        removeDownload(message.part)
      } catch (error) {
        console.warn(`Krya: could not remove ${message.part}`, error)
      }
      remeasure()
      return
    case 'restartSpeech':
      speech.restart()
      return
    case 'showInFolder':
      if (typeof message.path === 'string' && path.win32.isAbsolute(message.path)) shell.showItemInFolder(message.path)
      return
    case 'openPath':
      // A folder, a note or a text file; never a program, a script or a shortcut. One of Krya's own
      // folders not made yet (the transcripts' before the first transcript) is made, then opened.
      makeOwnFolder(message.path)
      if (openable(message.path, isDirectory)) void shell.openPath(message.path)
      else log(`openPath: refused ${message.path}`)
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
      voiceStore.download().catch(error => console.warn('Krya: the natural voice did not download', error))
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
      closeCard().catch(error => console.warn('Krya: could not give the keyboard back', error))
      return
    case 'retry':
      if (last && shown?.id === last.id) void translateInto(last.id, last.text, last.kind, last.note)
      return
    case 'translateText':
      void translateTextCard(message.id, message.text, message.from, message.to)
      return
    case 'checkText':
      void checkCard(message.id, message.text)
      return
    case 'copyText':
      clipboard.writeText(message.text).catch(error => console.warn('Krya: could not copy', error))
      return
    case 'pasteText':
      pasteTranslation(message.id, message.text).catch(error => console.warn('Krya: could not paste the translation', error))
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
      // A page loaded afresh records nothing.
      if (micRecording) {
        micRecording = false
        refreshTray()
      }
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
      exportWords().catch(error => console.warn('Krya: could not save the words', error))
      return
    case 'copyWords':
      clipboard.writeText(wordsText(words.list())).catch(error => console.warn('Krya: could not copy the words', error))
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
    case 'micRecording':
      micRecording = message.on
      refreshTray()
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
    case 'keepWord': {
      // As the Kept as typed page adds one (and as Backspace after a fix does): fixed by itself no more.
      const keepWords = addKept(settings.keepWords, message.word)
      if (!keepWords) return
      learned.kept(keptForm(message.word))
      saveSettings({ keepWords })
      return
    }
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

/** Firefox's models (Fast), and the local models' two levels. */
let translator: Translator
let llm: LlmTranslators

/** The translator of the level picked in Settings; a card waits for it, never another. */
function activeTranslator(): Translator {
  return settings.translationLevel === 'fast' ? translator : llm[settings.translationLevel]
}

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
  const t = activeTranslator()
  try {
    pending({ status: 'translating' })
    if (t.state(native).status !== 'ready') {
      await t.prepare(native, s => {
        if (s.status === 'downloading') pending({ status: 'downloading', progress: s.progress, size: s.size })
      })
      pending({ status: 'translating' })
    }
    const lines = await translateLines(split, settings.native, t.translate)
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
  const file = path.join(app.getPath('temp'), `krya-${process.pid}-${id}.png`)
  try {
    fs.writeFileSync(file, png)
    const native = langCode(settings.native)
    // Every one of the person's languages Windows reads (their own first), English last; each line from the one that reads it best.
    const result = await recognize(file, [...new Set([native, ...settings.languages, 'en'].filter(Boolean))])
    if (result.readings.length === 0) return void setState(id, { status: 'no-ocr' })
    const text = paragraphsOf(pickLines(result.readings, ocrKnown()))
    if (!text.trim()) return void setState(id, { status: 'empty' })
    const nativeRead = result.readings.some(r => r.lang.split('-')[0]?.toLowerCase() === native)
    return { text, misread: scriptFor(settings.native) !== 'Latin' && !nativeRead }
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
    console.warn('Krya: could not ask which field has the keyboard', error)
    return undefined
  }
}

/** The text selected in a field, through UI Automation; empty when it has none or will not say. */
function selectionIn(field: unknown): string {
  if (!field) return ''
  try {
    return selectedText(field).trim()
  } catch (error) {
    console.warn('Krya: could not read the selection through UI Automation', error)
    return ''
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
  await pasteInto(target.window, target.field, text + (target.after ?? ''))
}

/** The text pasted where the keyboard is in `window`, once it is in front, into `field` when known; the clipboard put back after. */
async function pasteInto(window: bigint, field: unknown, text: string): Promise<void> {
  await inFront(window)
  if (field) {
    try {
      // A web page in a window (VS Code's chat) takes the keyboard back a moment after.
      if (focus(field)) await new Promise(resolve => setTimeout(resolve, 80))
    } catch (error) {
      console.warn('Krya: could not give the keyboard back to the field', error)
    }
    releaseField(field)
  }
  await borrowClipboard(() => pasteText(text))
}

/** `text` pasted in the program in front: written to paste, Ctrl+V, the guard told. */
async function pasteText(text: string): Promise<void> {
  await clipGuard.write(text, true)
  await pressPaste()
  clipGuard.pasted()
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
  const t = activeTranslator()
  const missing = [from, to].some(code => code !== 'en' && t.state(code).status !== 'ready')
  if (missing) return translateWindow(text, at, window, via)
  keyboard.say('…')
  try {
    const out = await translatePlain(text.slice(0, MAX_TEXT_CHARS), from, to, t.translate, t.direct)
    keyboard.say('')
    if (!out.trim()) return
    logTranslation(text, out, from, to)
    if (foreground().hwnd !== window) return translateWindow(text, at, window, via)
    await keysLetGo()
    await pasteInto(window, undefined, out)
  } catch (error) {
    keyboard.say('')
    tray?.displayBalloon({ title: 'Krya', content: `Could not translate: ${messageOf(error)}` })
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
  const t = activeTranslator()
  try {
    set({ status: 'translating' })
    for (const code of [from, to]) {
      if (code === 'en' || t.state(code).status === 'ready') continue
      await t.prepare(code, state => {
        if (current() && state.status === 'downloading') set({ status: 'downloading', language: code, progress: state.progress, size: state.size })
      })
      if (current()) set({ status: 'translating' })
    }
    const lines = await translatePairs(text.slice(0, MAX_TEXT_CHARS), from, to, t.translate, t.direct)
    const sentences = lines.flatMap(line => line.pairs.map(p => p.src))
    if (current()) set({ status: 'ready', text: plainText(lines), from, to, html: textOutHtml(lines), sentences })
  } catch (error) {
    if (current()) set({ status: 'failed', message: messageOf(error) })
  }
}

// ---------------------------------------------------------------- checking English

/** Check my English (the one local model, which translates too, on llama.cpp's server), and the mistakes it found. */
let llmFiles: LlmFiles
let checker: Checker
let mistakes: MistakeStore

/** The latest check asked of a check card: an older one, still running, is not shown. */
let checkAsked = 0

/**
 * Opens Check my English by the pointer with a text (empty: one to type),
 * checked at once; `window` (and its `field`): where it was selected or
 * dictated, to paste the text set right back into, `after` it.
 */
function checkWindow(text: string, at: Point, window?: bigint, via?: string, field?: unknown, after?: string): void {
  const id = openCard('check', { status: 'check', text, result: { status: 'none' }, model: LEVEL_NAMES[settings.model], canPaste: !!window }, at, via)
  releaseField(pasteTarget?.field)
  pasteTarget = window ? { id, window, field, ...(after ? { after } : {}) } : undefined
  if (!window) releaseField(field)
  if (text.trim()) void checkCard(id, text)
}

/** Practice: a phrase spoken in English, checked by the pointer; Paste types it set right where the cursor was, a space after it. */
function practice(text: string): void {
  checkWindow(text, screen.getCursorScreenPoint(), foreground().hwnd, settings.practiceKey, focusedField(), ' ')
}

/** Checks the card's text, as it stands; its model downloaded first, the first time. */
async function checkCard(id: number, text: string): Promise<void> {
  const set = (result: CheckResult) => {
    if (shown?.id === id && shown.state.status === 'check') setState(id, { ...shown.state, text, result })
  }
  const asked = ++checkAsked
  const current = () => asked === checkAsked
  try {
    set({ status: 'checking' })
    if (checker.state().status !== 'ready') {
      await checker.prepare(state => {
        if (current() && state.status === 'downloading') set({ status: 'downloading', progress: state.progress, size: state.size })
        postApp()
      })
      if (current()) set({ status: 'checking' })
    }
    const out = await checker.check(text, langCode(settings.native))
    if (current()) set({ status: 'ready', text, corrected: out.corrected, parts: wordDiff(text, out.corrected), note: out.note })
  } catch (error) {
    if (current()) set({ status: 'failed', message: messageOf(error) })
  }
}

/** The model in use downloaded ahead (the Check page's Use). */
function prepareModel(): void {
  checker
    .prepare(() => postApp())
    .catch(error => console.warn('Krya: the model did not download', error))
    .finally(() => (postApp(), remeasure()))
}

/** A checked text with a mistake, kept for Library › Mistakes. */
function logMistake(result: Extract<CheckResult, { status: 'ready' }>): void {
  if (mistakes.add({ text: result.text, corrected: result.corrected, note: result.note })) postApp()
}

/** Opens Windows' snipping overlay; the text of the picture it puts on the clipboard is shown to listen to, or translated. */
function snip(purpose: Purpose = 'listen', via?: string): void {
  hideCard()
  snipFor = purpose
  snipVia = via
  snipSince = Date.now()
  // The snip lands on the clipboard: what the person had there goes back once it is read.
  clipGuard.hold()
  void shell.openExternal('ms-screenclip:')
}

/** The snip waited for is not coming (a copy without a picture): the clipboard was the person's to change, nothing to put back. */
function endSnip(): void {
  snipSince = 0
  clipGuard.drop()
}

/** Shows a picked text by the pointer: the card to listen to, or the translator; `window`: where it was selected (`field`, the field in it), or pastes its translation over it. */
function showText(text: string, purpose: Purpose, at: Point, window?: bigint, via?: string, field?: unknown): void {
  if (purpose === 'translate') return translateWindow(text, at, window, via, field)
  if (purpose === 'check') return checkWindow(text, at, window, via, field)
  releaseField(field)
  if (purpose === 'inPlace' && window) void translateInPlace(text, at, window, via)
  else translateText(text, 'selection', at, via)
}

async function useClipboard(purpose: Purpose): Promise<void> {
  const text = (await clipboard.readText()).trim()
  if (text) showText(text, purpose, screen.getCursorScreenPoint())
  else tray?.displayBalloon({ title: 'Krya', content: 'The clipboard holds no text. Select a text and copy it first.' })
}

/** A selection key: Krya presses Ctrl+C in the program in front and shows what it copies; the clipboard is put back after. */
async function useSelection(purpose: Purpose, via?: string): Promise<void> {
  const at = screen.getCursorScreenPoint()
  const front = foreground()
  const window = front.hwnd
  const exe = exeOf(front.pid)
  // The translator's (and the checker's) Paste gives the keyboard back to this field; any purpose reads its selection when no copy comes.
  const field = focusedField()
  snipSince = 0
  clipGuard.hold()
  await pressCopy()
  const since = Date.now()
  releaseField(copyWanted?.field)
  copyWanted = { since, at, purpose, window, field, exe, ...(via ? { via } : {}) }
  setTimeout(() => {
    if (copyWanted?.since !== since) return
    const text = selectionIn(field)
    if (!text) return
    copyWanted = undefined
    // A copy the program makes after all is its late answer: taken back with the rest.
    lateCopyUntil = Date.now() + LATE_COPY_MS
    clipGuard.release(LATE_COPY_MS)
    log(`copy: none in ${UIA_WAIT_MS} ms, read ${text.length} chars by UI Automation from ${exe}`)
    showText(text, purpose, at, window, via, field)
  }, UIA_WAIT_MS)
  setTimeout(() => {
    if (copyWanted?.since !== since) return
    releaseField(copyWanted.field)
    copyWanted = undefined
    lateCopyUntil = Date.now() + LATE_COPY_MS
    // Put back once a late copy has had its time; nothing changed, nothing is written.
    clipGuard.release(LATE_COPY_MS)
    log(`copy: nothing in ${COPY_WAIT_MS} ms from ${exe}`)
    tray?.displayBalloon({ title: 'Krya', content: 'Nothing was copied. Select a text, then press the shortcut.' })
  }, COPY_WAIT_MS)
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
  setTimeout(() => read().catch(error => console.warn('Krya: could not read the clipboard', error)), SETTLE_MS)
}

function onClipboardChange(): void {
  const now = Date.now()
  if (clipboardBusy || now < ownClipboardUntil || clipGuard.isOurs()) return
  const ctrl = ctrlHeld()
  if (copyWanted && now - copyWanted.since < COPY_WAIT_MS) {
    const { at, purpose, window, field, via } = copyWanted
    log(`copy: came in ${now - copyWanted.since} ms from ${copyWanted.exe}`)
    copyWanted = undefined
    // A password manager's copy (marked "do not watch") is neither shown nor read aloud.
    const secret = privateCopy()
    afterSettling(async () => {
      // The copy Krya pressed: taken back once read.
      clipGuard.claim()
      const text = secret ? '' : (await clipboard.readText()).trim()
      await clipGuard.putBack()
      if (secret) log('copy: a copy marked private (a password manager) is left alone')
      if (text) showText(text, purpose, at, window, via, field)
      else releaseField(field)
    })
    return
  }
  if (now < lateCopyUntil && !ctrl) {
    // The program's late answer to Krya's Ctrl+C: put back with the rest, when clipGuard's wait ends.
    lateCopyUntil = 0
    clipGuard.claim()
    return
  }
  if (snipSince && now - snipSince < SNIP_WAIT_MS) {
    afterSettling(async () => {
      const png = await clipboardPng()
      if (!snipSince) return
      // A copy without a picture is the person's own: the snip is not coming.
      if (!png) {
        endSnip()
        return doubleCopyChange(now, ctrl)
      }
      snipSince = 0
      // The picture is read; what the person had goes back.
      clipGuard.claim()
      await clipGuard.putBack()
      await (snipFor === 'translate' ? readScreenText(png, snipVia) : readScreenshot(png, snipVia))
    })
    return
  }
  doubleCopyChange(now, ctrl)
}

/** A change of the clipboard by the person: Ctrl+C twice asks for the card. */
function doubleCopyChange(now: number, ctrl: boolean): void {
  // Copying from the card itself is not a request, nor is any copy while Krya is paused, nor a password
  // manager's copy (marked "do not watch"): Ctrl+C twice on a password never shows or reads it.
  if (card?.isFocused() || !settings.doubleCopy || settings.paused || privateCopy()) return
  if (!copies.change(now, ctrl)) return
  const at = screen.getCursorScreenPoint()
  afterSettling(async () => {
    const text = (await clipboard.readText()).trim()
    if (text) translateText(text, 'selection', at, DOUBLE_COPY)
  })
}

function selection(purpose: Purpose, via?: string): void {
  useSelection(purpose, via).catch(error => console.warn('Krya: could not copy the selection', error))
}

/** The pause key: Krya paused, or back. */
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
    keysOk = { snip: true, select: true, translate: true, text: true, inPlace: true, check: true, type: true, typeCheck: true, pause: register(settings.pauseKey, togglePause), window: true }
    speechKeysOk = { dictate: true, english: true, note: true, again: true, practice: true }
    return
  }
  keysOk = {
    snip: register(settings.snipKey, () => snip('listen', settings.snipKey)),
    select: register(settings.selectKey, () => selection('listen', settings.selectKey)),
    translate: register(settings.translateKey, () => selection('translate', settings.translateKey)),
    text: register(settings.textKey, () => snip('translate', settings.textKey)),
    inPlace: register(settings.inPlaceKey, () => selection('inPlace', settings.inPlaceKey)),
    check: register(settings.checkKey, () => selection('check', settings.checkKey)),
    type: register(settings.typeKey, () => typeInto('translate', settings.typeKey)),
    typeCheck: register(settings.typeCheckKey, () => typeInto('check', settings.typeCheckKey)),
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
    practice: dictate('check', settings.practiceKey),
  }
  const taken = [
    !keysOk.snip && settings.snipKey,
    !keysOk.select && settings.selectKey,
    !keysOk.translate && settings.translateKey,
    !keysOk.text && settings.textKey,
    !keysOk.inPlace && settings.inPlaceKey,
    !keysOk.check && settings.checkKey,
    !keysOk.type && settings.typeKey,
    !keysOk.typeCheck && settings.typeCheckKey,
    !keysOk.pause && settings.pauseKey,
    !keysOk.window && settings.windowKey,
    !speechKeysOk.dictate && settings.dictateKey,
    !speechKeysOk.english && settings.englishKey,
    !speechKeysOk.note && settings.noteKey,
    !speechKeysOk.again && settings.againKey,
    !speechKeysOk.practice && settings.practiceKey,
  ].filter((k): k is string => !!k)
  // The settings window shows the trouble itself; the balloon is for a start without it.
  if (taken.length > 0 && !(appWin?.isVisible() ?? false)) {
    tray?.displayBalloon({
      title: 'Krya',
      content: `${taken.map(keyLabel).join(' and ')} ${taken.length > 1 ? 'are' : 'is'} taken by another program. Choose another in the settings.`,
    })
  }
}

// ---------------------------------------------------------------- the keyboard

function applyKeyboard(): void {
  keyboardTrouble = undefined
  try {
    // Dictate's keys work only once the engine is installed, here as with Electron's shortcuts; paused, the helper keeps the pause key alone.
    keyboard.apply(speech?.installed ? settings : { ...settings, dictateKey: '', englishKey: '', noteKey: '', againKey: '', practiceKey: '' }, learned.forThread())
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

/**
 * Krya pastes through the clipboard: what the person had there is kept
 * (once for a run of such pastes) and goes back once `work` is done, or has
 * failed: a moment after the program read the pasted text, or `after` ms;
 * a snip still awaited is no longer.
 */
async function borrowClipboard<T>(work: () => Promise<T>, after: (result: T | undefined) => number | undefined = () => undefined): Promise<T> {
  snipSince = 0
  clipGuard.hold()
  let result: T | undefined
  try {
    result = await ownClipboard(work)
    return result
  } finally {
    clipGuard.release(after(result))
  }
}

/** Runs Krya's own use of the clipboard; the changes it makes, until a moment after, are not taken for requests. */
async function ownClipboard<T>(work: () => Promise<T>): Promise<T> {
  clipboardBusy = true
  try {
    return await work()
  } finally {
    clipboardBusy = false
    ownClipboardUntil = Date.now() + OWN_CLIPBOARD_MS
  }
}

/**
 * The fix key with a selection: Krya copies it, types it again in the
 * next layout of `cycle` (the one after the layout it was typed in), pastes
 * it over the selection, selects it again (a second press goes on to the
 * next layout), switches the layout and puts the clipboard back.
 */
async function convertSelection(cycle: string[]): Promise<void> {
  // Nothing pasted (or a failure): the clipboard goes back at once.
  await borrowClipboard(
    () => convertOver(cycle),
    restore => (restore === 'later' ? undefined : 0),
  )
}

/** Copies the selection, pastes it converted; 'now' when nothing was pasted and the clipboard can go back at once. */
async function convertOver(cycle: string[]): Promise<'now' | 'later'> {
  const marker = `Krya ${Date.now()}`
  const field = focusedField()
  await clipGuard.write(marker)
  await pressCopy()
  let text = ''
  let copied = false
  const started = Date.now()
  for (let asked = false; !text && Date.now() < started + COPY_WAIT_MS; ) {
    await new Promise(resolve => setTimeout(resolve, 20))
    const now = await clipboard.readText()
    if (now !== marker) {
      text = now
      copied = true
    } else if (!asked && Date.now() >= started + UIA_WAIT_MS) {
      // A field that does not answer Ctrl+C: its selection through UI Automation.
      asked = true
      text = selectionIn(field)
    }
  }
  releaseField(field)
  // The copy Krya pressed is its own to take back.
  if (copied) clipGuard.claim()
  const layouts = cycle.map(id => ({ id, table: tableFor(id) })).filter((l): l is { id: string; table: KeyTable } => !!l.table)
  const from = text ? sourceLayout(text, layouts) : undefined
  const to = nextLayout(cycle, from)
  const fromTable = from ? tableFor(from) : undefined
  const toTable = to ? tableFor(to) : undefined
  if (!fromTable || !toTable || !to || from === to) return 'now'
  const converted = convertText(text, fromTable, toTable)
  await pasteText(converted)
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
  execFile(system32('tasklist.exe'), ['/fo', 'csv', '/nh'], { windowsHide: true }, (error, stdout) => {
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
    keys: { listenCopied: settings.doubleCopy ? DOUBLE_COPY : '', typeToTranslate: settings.typeKey, checkEnglish: settings.typeCheckKey, snipListen: settings.snipKey, snipTranslate: settings.textKey, switch: settings.switchKey },
    autoFix: settings.autoFix,
    switchOn: settings.switchOn,
    layoutBadge: settings.layoutBadge,
    trayLayout: settings.trayLayout,
    doubleCopy: settings.doubleCopy,
    paused: settings.paused,
    keep: {
      on: settings.autoFix || (!!settings.fixKey && settings.fixKeyOn),
      ...(lastAutoFix && !settings.keepWords.includes(lastAutoFix.word) ? lastAutoFix : { word: '', fixed: '' }),
    },
    speech: { installed: speech?.installed ?? false, recording: dictation?.state === 'recording', noteKey: settings.noteKey },
    translator: activeTranslator().state(langCode(settings.native)).status,
    native: settings.native,
    version: app.getVersion(),
    build: buildText(),
    dev: !app.isPackaged,
  }
}

function refreshTray(): void {
  if (!tray) return
  tray.setToolTip(tooltip())
  void refreshTrayIcon()
  sendTrayView()
}

/** The tray's panel drawn again, the icon left as it is. */
function sendTrayView(): void {
  if (trayPanel && trayReady && !trayPanel.isDestroyed()) trayPanel.webContents.send('to-view', { type: 'tray', view: trayView() } satisfies ToView)
}

/** Something records now: dictation listening (any of its keys), the microphone on the Transcribe page, or a meeting through the Chrome extension. */
function recordingNow(): boolean {
  return dictation?.state === 'recording' || micRecording || !!speech?.meeting
}

/** The taskbar's theme, which the tray's icon follows (not the app's theme setting). */
const darkTaskbar = () => nativeTheme.shouldUseDarkColorsForSystemIntegratedUI

/**
 * The tray's icon: the red dot while anything records (over everything else);
 * else the layout in front on its keycap when the person wants that; else the
 * duck, faded while paused. All drawn for the taskbar's theme.
 */
async function refreshTrayIcon(): Promise<void> {
  if (recordingNow()) return tray?.setImage(trayIcon('recording'))
  const dark = darkTaskbar()
  const front = settings.trayLayout && !settings.paused ? frontLayout : undefined
  const icon = front ? await layoutIcon(keyboard.shortOf(front.layout).toLowerCase(), front.caps, dark) : undefined
  // The recording may have begun while the keycap was drawn.
  if (recordingNow()) return tray?.setImage(trayIcon('recording'))
  tray?.setImage(icon ?? trayIcon(`${dark ? 'dark' : 'light'}${settings.paused ? '-paused' : ''}`))
}

/**
 * Runs in the tray panel's page: a layout's short name ("en") on a keycap in
 * the tray duck's colours (scripts/icons.mjs), `size` pixels, as a PNG data
 * URL: the cap in the taskbar's ink, its lower edge in the duck's colour, the
 * letters (underlined with Caps Lock on) cut out of it, so the taskbar shows
 * through them as through Windows' own glyphs.
 */
function drawLayoutCap(size: number, text: string, caps: boolean, ink: string, duck: string): string {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d') as CanvasRenderingContext2D
  const s = size / 16
  // One rounded shape, so its corners have one edge: the duck's colour, the cap's ink over all but its lower edge.
  g.beginPath()
  g.roundRect(0, 0, 16 * s, 16 * s, 3.5 * s)
  g.clip()
  g.fillStyle = ink
  g.fillRect(0, 0, 16 * s, 14 * s)
  g.fillStyle = duck
  g.fillRect(0, 14 * s, 16 * s, 2 * s)
  g.globalCompositeOperation = 'destination-out'
  g.fillStyle = '#000'
  g.font = `800 ${size >= 32 ? 15 : 8}px "JetBrains Mono", monospace`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(text.slice(0, 2), 8 * s, 6.9 * s)
  if (caps) g.fillRect(4 * s, 10.5 * s, 8 * s, Math.max(1, s))
  return canvas.toDataURL('image/png')
}

/** The tray's ink and the duck's colour on a light and on a dark taskbar (scripts/icons.mjs `TASKBAR`). */
const TASKBAR_COLOURS = { light: ['#1b1b1b', '#F2A100'], dark: ['#f2f2f2', '#FFD60A'] } as const

const layoutIcons = new Map<string, Electron.NativeImage>()
async function layoutIcon(short: string, caps: boolean, dark: boolean): Promise<Electron.NativeImage | undefined> {
  const key = `${short}${caps ? '^' : ''}${dark ? ':dark' : ':light'}`
  const known = layoutIcons.get(key)
  if (known) return known
  if (!trayPanel || !trayReady || trayPanel.isDestroyed()) return undefined
  const [ink, duck] = TASKBAR_COLOURS[dark ? 'dark' : 'light']
  try {
    const draw = (size: number) =>
      trayPanel?.webContents.executeJavaScript(`(${drawLayoutCap.toString()})(${size}, ${JSON.stringify(short)}, ${caps}, ${JSON.stringify(ink)}, ${JSON.stringify(duck)})`) as Promise<string>
    const icon = nativeImage.createEmpty()
    icon.addRepresentation({ scaleFactor: 1, dataURL: await draw(16) })
    icon.addRepresentation({ scaleFactor: 2, dataURL: await draw(32) })
    layoutIcons.set(key, icon)
    return icon
  } catch (error) {
    console.warn('Krya: could not draw the layout in the tray', error)
    return undefined
  }
}

function tooltip(): string {
  if (recordingNow()) return 'Recording'
  if (settings.paused) return 'Krya · paused'
  const ways = [settings.doubleCopy ? 'Ctrl+C twice' : '', settings.selectKey ? keyLabel(settings.selectKey) : ''].filter(Boolean)
  const listen = ways.length ? `${ways.join(' or ')} to listen` : ''
  const translate = settings.translateKey ? `${keyLabel(settings.translateKey)} to translate` : ''
  return ['Krya', listen, translate].filter(Boolean).join(' · ')
}

/** The tray's pictures (scripts/icons.mjs): the duck for a light or a dark taskbar, faded while paused, and the red dot while recording. */
type TrayPicture = 'light' | 'dark' | 'light-paused' | 'dark-paused' | 'recording'

/** Each picture, made once: media/tray-<picture>.png. */
const trayIcons = new Map<TrayPicture, Electron.NativeImage>()
function trayIcon(picture: TrayPicture): Electron.NativeImage {
  let icon = trayIcons.get(picture)
  if (!icon) {
    // The 16 px picture set pixel by pixel; Electron takes the @2x file beside it on a screen at 200 %.
    icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'media', `tray-${picture}.png`))
    trayIcons.set(picture, icon)
  }
  return icon
}

function createTray(): Tray {
  const t = new Tray(trayIcon(`${darkTaskbar() ? 'dark' : 'light'}${settings.paused ? '-paused' : ''}`))
  // Either button opens Krya's own panel: Windows' menu cannot take Krya's look.
  t.on('click', () => toggleTrayPanel())
  t.on('right-click', () => toggleTrayPanel())
  return t
}

/** The tray's panel: a window of Krya's own by the tray icon, made once and hidden between uses. */
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
    title: 'Krya',
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
  if (!app.isPackaged) win.webContents.on('console-message', m => console.warn(`Krya tray panel: ${m.message} (${m.sourceId}:${m.lineNumber})`))
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

/** An empty translator or checker by the pointer, to type into (the tray's rows, their keys); nothing to paste back into. */
function typeInto(kind: 'translate' | 'check', via?: string): void {
  if (kind === 'translate') translateWindow('', screen.getCursorScreenPoint(), undefined, via)
  else checkWindow('', screen.getCursorScreenPoint(), undefined, via)
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
      typeInto('translate')
      return
    case 'checkEnglish':
      typeInto('check')
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
 * For a mouse button or a launcher: `Krya --clipboard` listens to the
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
  // Started again by Move to Krya: back on the Storage page, measured anew.
  if (argv.includes('--storage')) {
    openApp('storage')
    return true
  }
  return false
}

// ---------------------------------------------------------------- start

// ---------------------------------------------------------------- the speech engine

/** Types a text in the program in front, through the clipboard, which is put back as it was. */
async function typeText(text: string): Promise<void> {
  await keysLetGo()
  await borrowClipboard(() => pasteText(text))
}

/**
 * Types an address into the browser window in front: Ctrl+L, the address pasted (a pasted address is not
 * completed into another one, as typed letters may be), Enter; the clipboard put back after.
 */
async function typeAddress(url: string): Promise<void> {
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
  await borrowClipboard(async () => {
    await clipGuard.write(url, true)
    await pressAddressBar()
    await pause(120)
    await pressPaste()
    clipGuard.pasted()
    await pause(120)
    pressEnter()
  })
}

function balloon(title: string, content: string, click?: () => void): void {
  balloonClick = click
  tray?.displayBalloon({ title, content })
}

function setUpSpeechEngine(): void {
  speech = new SpeechHost({
    root: localPart('speech'),
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
    speech,
    paste: typeText,
    toEnglish: (text, from) => {
      const t = activeTranslator()
      return translatePlain(text, from, 'en', t.translate, t.direct)
    },
    check: practice,
    expected: () => myLanguages(settings),
    languageOf: text => languageOf(text, settings.native, languageWords(), myLanguages(settings)),
    balloon,
    needsEngine: () => openApp('dictate'),
    openTranscript,
    onChange: () => {
      keyboard?.dictating(dictation.state !== 'idle')
      refreshTray()
    },
    log: dictationLog,
    logged: () => postApp(),
    offset: () => settings.dictationBadge,
    moved: offset => saveSettings({ dictationBadge: offset }),
  })
  // The app window plays a transcript's sound from the engine in an <audio>, which sends no header of its own:
  // main adds the engine's key to that window's requests to the engine, and to no other window's.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`http://127.0.0.1:${speechPort}/*`] }, (details, done) => {
    const fromApp = !!appWin && !appWin.isDestroyed() && details.webContentsId === appWin.webContents.id
    const key = fromApp ? speech.token : undefined
    done({ requestHeaders: key ? { ...details.requestHeaders, 'X-Krya-Token': key } : details.requestHeaders })
  })
  speech.start()
  // Windows is asked about the cards and the battery once Krya is up: it takes a second or two.
  setTimeout(() => void speech.probe().catch(error => console.warn('Krya: could not look at this computer', error)), 4000)
}

/** The formats a transcript is saved in (the engine's export.FORMATS). */
const EXPORT_FORMATS = new Set(['txt', 'md', 'srt', 'vtt', 'docx', 'json'])

const isDirectory = (p: string) => fs.statSync(p).isDirectory()

/** Makes `p` when it is one of Krya's own folders (its settings, its downloads, the transcripts') and not there yet. */
function makeOwnFolder(p: unknown): void {
  if (typeof p !== 'string' || fs.existsSync(p)) return
  const same = (a: string) => path.win32.resolve(a).toLowerCase() === path.win32.resolve(p).toLowerCase()
  const own = [userDir(), localDir(), speech?.service.health?.dataDir].filter((f): f is string => !!f)
  if (!own.some(same)) return
  try {
    fs.mkdirSync(p, { recursive: true })
  } catch (e) {
    log(`openPath: could not make ${p}: ${String(e)}`)
  }
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
      if (!EXPORT_FORMATS.has(request.format)) throw new Error(`Cannot save as ${request.format}`)
      const safe = request.name.replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').trim() || 'Transcript'
      const options: Electron.SaveDialogOptions = {
        title: 'Save the transcript',
        defaultPath: path.join(app.getPath('documents'), `${safe}.${request.format}`),
        filters: [{ name: request.format.toUpperCase(), extensions: [request.format] }],
      }
      const { canceled, filePath } = appWin ? await dialog.showSaveDialog(appWin, options) : await dialog.showSaveDialog(options)
      if (canceled || !filePath) return null
      // The engine gives the bytes; Krya writes them where the person chose (the engine writes no file a caller names).
      fs.writeFileSync(filePath, await speech.bytes(`/transcripts/${encodeURIComponent(request.id)}/file?format=${request.format}`))
      return filePath
    }
    case 'copy':
      await clipboard.writeText(request.text)
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
  if (oldAppRunning()) {
    dialog.showMessageBoxSync({ type: 'info', title: 'Krya', message: 'Altype is still running', detail: "Krya is Altype's new name. Quit Altype from its tray menu, then start Krya: it takes over your settings, words and downloads." })
    app.quit()
    return
  }
  const adopted = adoptOldFolder()
  // krya.log beside the settings: the warnings, and what the windows did.
  logTo(userDir())
  const warn = console.warn.bind(console)
  console.warn = (...parts: unknown[]) => {
    warn(...parts)
    log(`warn: ${parts.map(p => (p instanceof Error ? (p.stack ?? p.message) : String(p))).join(' ')}`)
  }
  log(`start: Krya ${app.getVersion()}, Electron ${process.versions.electron}, Windows ${process.getSystemVersion()}${TEST_HOME ? ', test home' : ''}`)
  // Everything downloaded in one folder (moveLocalFolder): what 0.10.0 and before kept in %APPDATA% moves over too.
  logMoved(adopted)
  const firstRun = !fs.existsSync(settingsFile())
  settings = readSettings()
  // Only a fresh install sees the setup; a settings file from before it counts as set up (the default).
  if (firstRun) saveSettings({ setupDone: false })
  applyTheme()
  // Windows' own light or dark, switched while Krya runs (the theme "system"), repaints the windows' ground and edge, and the tray's icon for the taskbar.
  nativeTheme.on('updated', () => {
    applyColors()
    refreshTray()
  })
  applyLoginItem()
  setUpSpeech()
  words = new WordStore(path.join(userDir(), 'words.json'))
  dictationLog = new DictationLog(path.join(userDir(), 'dictation.json'))
  translationLog = new TranslationLog(path.join(userDir(), 'translations.json'))
  learned = new LearnStore(path.join(userDir(), 'learning.json'))
  translator = createTranslator(downloads('models'), unpacked('dist', 'mt-worker.js'), {
    loader: unpacked('vendor', 'bergamot', 'bergamot-translator.js'),
    wasm: unpacked('vendor', 'bergamot', 'bergamot.wasm'),
  })
  llmFiles = createLlmFiles({
    root: localPart('translate'),
    // One server for translating and checking: one model on the card at a time, the same for both.
    server: new LlamaServer({ log: path.join(userDir(), 'translate.log') }),
    // A model that does not fit an NVIDIA card goes to llama.cpp's CUDA build, far quicker there than Vulkan.
    engineFor: model => (translationAdvice(speech?.profile)[model].cuda ? 'cuda' : 'vulkan'),
  })
  llm = createLlmTranslators({ files: llmFiles, onTimed: modelTimed })
  checker = createChecker({ files: llmFiles, model: () => settings.model, onTimed: modelTimed })
  mistakes = new MistakeStore(path.join(userDir(), 'mistakes.json'))
  modelSpeeds = loadModelSpeeds(deviceFile())
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
    // The tray's "Keep a word as typed…" offers the last one (only from a field not known to be a password).
    autoFixed: (word, fixed) => {
      lastAutoFix = { word, fixed }
      sendTrayView()
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
    selection: cycle => void convertSelection(cycle).catch(error => console.warn('Krya: could not convert the selection', error)),
    hotkey: action => {
      if (action === 'pause') return togglePause()
      // Paused, the thread keeps the pause key alone; a key on its way meanwhile does nothing.
      if (settings.paused) return
      if (action === 'dictate') dictation.press('type', settings.dictateKey)
      else if (action === 'english') dictation.press('english', settings.englishKey)
      else if (action === 'note') dictation.press('note', settings.noteKey)
      else if (action === 'again') dictation.typeAgain()
      else if (action === 'practice') dictation.press('check', settings.practiceKey)
      else if (action === 'select') selection('listen', settings.selectKey)
      else if (action === 'translate') selection('translate', settings.translateKey)
      else if (action === 'inPlace') selection('inPlace', settings.inPlaceKey)
      else if (action === 'check') selection('check', settings.checkKey)
      else if (action === 'type') typeInto('translate', settings.typeKey)
      else if (action === 'typeCheck') typeInto('check', settings.typeCheckKey)
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
      console.warn(`Krya keyboard: ${message}`)
      postApp()
    },
  })
  applyKeyboard()
  card = createCard()
  // Each page only what it does (bridge.ts): a page that shows text from outside never opens, removes or exports.
  ipcMain.on('to-host', (event, message: ToHost) => {
    const page = pageOf(event.sender.getURL())
    if (messageAllowed(page, message?.type) && (message.type !== 'saveSettings' || patchAllowed(page, message.patch))) onMessage(message)
    else log(`bridge: ${page} may not send ${String(message?.type)}`)
  })
  ipcMain.handle('host-call', (event, request: HostCall) => {
    const page = pageOf(event.sender.getURL())
    if (callAllowed(page, request)) return hostCall(request)
    log(`bridge: ${page} may not call ${String(request?.call)}`)
    throw new Error('Not allowed from this window')
  })
  // The card's window owns Krya's pasted text: handed over when the paste's program reads it.
  const stopRendering = watchRendering(
    card,
    () => {
      const { reader, front } = clipboardReaders()
      if (clipGuard.read(reader, front)) renderClipboardText()
    },
    renderAllClipboardText,
  )
  stopWatching = stopRendering
  try {
    const stopChanges = watchClipboard(card, onClipboardChange)
    stopWatching = () => {
      stopChanges()
      stopRendering()
    }
  } catch (error) {
    tray.displayBalloon({ title: 'Krya', content: `Ctrl+C twice will not work: ${messageOf(error)}. Use the tray menu.` })
  }
  void sendHostVoices()
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
    // Quitting within a paste's moment: what the person had goes back now, while the card's window can still own the clipboard.
    clipGuard.flush()
  })
  // The card is hidden, never closed: Krya keeps running in the tray.
  app.on('window-all-closed', () => undefined)
  // Each part is put away on its own: one that fails must not keep the app from quitting.
  app.on('will-quit', () => {
    const steps: [string, () => void][] = [
      ['shortcuts', () => globalShortcut.unregisterAll()],
      ['speech', () => speech?.dispose()],
      ['dictation', () => dictation?.dispose()],
      ['clipboard', () => stopWatching?.()],
      ['voice', () => natural?.dispose()],
      ['translator', () => translator?.dispose()],
      ['translation models', () => llmFiles?.dispose()],
      ['keyboard', () => keyboard?.dispose()],
      ['learning', () => learned?.flush()],
    ]
    for (const [name, step] of steps) {
      try {
        step()
      } catch (error) {
        console.warn(`Krya: could not put away the ${name}`, error)
      }
    }
  })
  void app.whenReady().then(start)
}
