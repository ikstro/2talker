// Chrome's own pages (chrome://extensions/) cannot be opened by a link, by
// Windows' default browser, or by chrome.exe itself: Chrome drops a chrome://
// address that another program hands it. So Krya opens a new Chrome window
// and types the address into its address bar, as the person would; only into
// that new window, and when it does not come, the page copies the address for
// the person to paste. Where Chrome is: the App Paths key Chrome's installer
// writes (for all users, then for this one), else the folders it installs into.

import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { system32 } from './system32'

/** The only pages a page of Krya may open in Chrome: the extensions, their keys, and one extension's card. */
export const CHROME_PAGES = ['chrome://extensions/', 'chrome://extensions/shortcuts']
const EXTENSION_CARD = /^chrome:\/\/extensions\/\?id=[a-p]{32}$/

export const isChromePage = (url: string) => CHROME_PAGES.includes(url) || EXTENSION_CARD.test(url)

const APP_PATHS = 'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'

/** The default value in `reg query … /ve` output: "(Default)    REG_SZ    C:\…\chrome.exe"; undefined when there is none. */
export function regDefault(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const m = /REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line.trim())
    if (m?.[1]) return m[1].trim().replace(/^"(.*)"$/, '$1') || undefined
  }
  return undefined
}

function regQuery(key: string): Promise<string | undefined> {
  return new Promise(resolve => {
    execFile(system32('reg.exe'), ['query', key, '/ve'], { windowsHide: true, timeout: 5000 }, (error, stdout) => resolve(error ? undefined : regDefault(stdout)))
  })
}

/** Where chrome.exe is, or undefined when Chrome is not installed. */
export async function findChrome(): Promise<string | undefined> {
  const env = process.env
  const candidates = [
    await regQuery(`HKLM\\${APP_PATHS}`),
    await regQuery(`HKCU\\${APP_PATHS}`),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ]
  return candidates.find((p): p is string => !!p && fs.existsSync(p))
}

/** What became of a page asked for: typed into a new Chrome window, Chrome opened without it, no Chrome, or not a page Krya opens. */
export type ChromeOpened = 'typed' | 'opened' | 'missing' | 'refused'

/** What opening a page needs from Windows; main.ts gives the real ones, the tests their own. */
export type ChromeDeps = {
  /** The window in front and its process. */
  front: () => { hwnd: bigint; pid: number }
  /** A process's .exe name, in lower case. */
  exeOf: (pid: number) => string
  /** Lets the Chrome that runs already come to the front (Windows asks the window in front to allow it). */
  allowFront: () => void
  /** Ctrl+L, the address pasted, Enter: in the window in front. */
  typeAddress: (url: string) => Promise<void>
  find?: () => Promise<string | undefined>
  start?: (exe: string, args: string[]) => void
  sleep?: (ms: number) => Promise<void>
  /** How long a new Chrome window may take to come to the front. */
  waitMs?: number
}

const sleeper = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function startDetached(exe: string, args: string[]): void {
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' })
  child.on('error', error => console.warn('Krya: Chrome would not start', error))
  child.unref()
}

/** Waits for a Chrome window in front that is not `before`; its handle, or undefined after `waitMs`. */
export async function waitForChrome(deps: ChromeDeps, before: bigint): Promise<bigint | undefined> {
  const sleep = deps.sleep ?? sleeper
  const until = Date.now() + (deps.waitMs ?? 8000)
  for (;;) {
    const front = deps.front()
    if (front.hwnd !== before && front.hwnd !== 0n && deps.exeOf(front.pid) === 'chrome.exe') return front.hwnd
    if (Date.now() >= until) return undefined
    await sleep(100)
  }
}

/** Opens one of Chrome's own pages: a new Chrome window, then the address typed into it. */
export async function openInChrome(url: string, deps: ChromeDeps): Promise<ChromeOpened> {
  if (!isChromePage(url)) return 'refused'
  const sleep = deps.sleep ?? sleeper
  try {
    const exe = await (deps.find ?? findChrome)()
    if (!exe) {
      console.warn('Krya: Chrome was not found')
      return 'missing'
    }
    const before = deps.front().hwnd
    deps.allowFront()
    ;(deps.start ?? startDetached)(exe, ['--new-window'])
    const window = await waitForChrome(deps, before)
    if (!window) return 'opened'
    // The new tab page takes a moment to put the cursor in the address bar; still the same window after it, the address goes in.
    await sleep(500)
    if (deps.front().hwnd !== window) return 'opened'
    await deps.typeAddress(url)
    return 'typed'
  } catch (error) {
    console.warn('Krya: Chrome would not start', error)
    return 'missing'
  }
}
