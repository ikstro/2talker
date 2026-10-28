// Chrome's own pages (chrome://extensions/) cannot be opened by a link or by
// Windows' default browser, so Altype starts chrome.exe with the page itself.
// Where Chrome is: the App Paths key Chrome's installer writes (for all users,
// then for this one), else the folders it installs into.

import { execFile, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** The only pages a page of Altype may open in Chrome: the extensions and their keys. */
export const CHROME_PAGES = ['chrome://extensions/', 'chrome://extensions/shortcuts']

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
    execFile('reg.exe', ['query', key, '/ve'], { windowsHide: true, timeout: 5000 }, (error, stdout) => resolve(error ? undefined : regDefault(stdout)))
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

/** Opens one of `CHROME_PAGES` in Chrome; false when the page is another, Chrome is missing or would not start. */
export async function openInChrome(url: string): Promise<boolean> {
  if (!CHROME_PAGES.includes(url)) return false
  try {
    const exe = await findChrome()
    if (!exe) {
      console.warn('Altype: Chrome was not found')
      return false
    }
    const child = spawn(exe, [url], { detached: true, stdio: 'ignore' })
    child.on('error', error => console.warn('Altype: Chrome would not start', error))
    child.unref()
    return true
  } catch (error) {
    console.warn('Altype: Chrome would not start', error)
    return false
  }
}
