// What each of Krya's pages may ask the main process for. Every page shares one
// preload (window.tutorHost), so main asks who sent a message before acting on
// it: the card, the tray panel and the dictation badge show text from outside
// (a copied text, the screen, a model's answer); were one of them ever made to
// run a script, it still could not install, remove, open or export anything,
// nor reach the speech engine beyond dictating.

import * as path from 'node:path'

import type { HostCall, ToHost } from './protocol'

export type Page = 'app' | 'card' | 'tray' | 'dictation' | 'other'

const PAGES: Record<string, Page> = { 'app.html': 'app', 'card.html': 'card', 'tray.html': 'tray', 'dictation.html': 'dictation' }

/** The page a window shows, by its file (media/<page>.html, with or without a query); 'other' for anything else. */
export function pageOf(url: string): Page {
  try {
    const u = new URL(url)
    return u.protocol === 'file:' ? (PAGES[path.posix.basename(u.pathname)] ?? 'other') : 'other'
  } catch {
    return 'other'
  }
}

/** Messages only the app window sends: they install, remove, reset, open or export. */
const APP_ONLY: ReadonlySet<ToHost['type']> = new Set<ToHost['type']>([
  'clearDictation',
  'clearTranslations',
  'clearMistakes',
  'forgetMistake',
  'unlearn',
  'forgetLearned',
  'exportBackup',
  'importBackup',
  'resetSettings',
  'resetKeys',
  'installSpeech',
  'prepareTranslator',
  'prepareDictionary',
  'translationLevel',
  'useModel',
  'useRecommended',
  'testSpeech',
  'downloadSpeechModel',
  'moveToKrya',
  'removeStored',
  'cleanUp',
  'restartSpeech',
  'showInFolder',
  'openPath',
  'removeWord',
  'exportWords',
  'copyWords',
  'openLink',
  'micRecording',
  'reportProblem',
  'openLogs',
])

export function messageAllowed(page: Page, type: string): boolean {
  if (page === 'other') return false
  return page === 'app' || !APP_ONLY.has(type as ToHost['type'])
}

/** The settings a page other than the app window may change: the card its reading mode, the tray panel its switches. */
const PAGE_SETTINGS: Partial<Record<Page, ReadonlySet<string>>> = {
  card: new Set(['oneAtATime']),
  tray: new Set(['autoFix', 'switchOn', 'layoutBadge', 'trayLayout', 'doubleCopy', 'paused']),
}

/** Whether `page` may save this settings patch: the app window any, the card and the tray panel only their own. */
export function patchAllowed(page: Page, patch: unknown): boolean {
  if (page === 'app') return true
  const own = PAGE_SETTINGS[page]
  return !!own && !!patch && typeof patch === 'object' && Object.keys(patch).every(key => own.has(key))
}

/** The path a route reaches, as fetch resolves it from the engine's address (%2e%2e and \ are .. and / there). */
function reached(route: string): string {
  try {
    return new URL(`http://127.0.0.1${route}`).pathname
  } catch {
    return ''
  }
}

/** The dictation badge dictates and records a note; the app window does everything; the others call nothing. */
export function callAllowed(page: Page, request: HostCall): boolean {
  if (page === 'app') return true
  const dictating = /^\/(dictate|recordings)([/?]|$)/
  if (page === 'dictation') return request.call === 'speech' && dictating.test(request.route) && dictating.test(reached(request.route))
  return false
}

/** Files the system may open from a page: notes and text; never a program, a script or a shortcut. */
const OPENABLE = new Set(['.md', '.txt'])

/**
 * Whether `p` may go to the system's "open" (ShellExecute runs .exe, .bat, .lnk and opens URLs): an
 * absolute path to a folder, or to a note or text file.
 */
export function openable(p: unknown, isDirectory: (p: string) => boolean): p is string {
  if (typeof p !== 'string' || !p || !path.win32.isAbsolute(p) || /^\\\\[?.]\\/.test(p) || /^[a-z][a-z0-9+.-]+:(?![\\/])/i.test(p)) return false
  if (OPENABLE.has(path.win32.extname(p).toLowerCase())) return true
  try {
    return isDirectory(p)
  } catch {
    return false
  }
}
