import { describe, expect, it } from 'vitest'
import { isChromePage, openInChrome, regDefault, type ChromeDeps } from './chrome'

describe('regDefault', () => {
  it('reads the default value of reg query /ve', () => {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe\r\n    (Default)    REG_SZ    C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\r\n\r\n'
    expect(regDefault(out)).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  })

  it('drops quotes and takes REG_EXPAND_SZ', () => {
    expect(regDefault('    (Default)    REG_EXPAND_SZ    "C:\\Chrome\\chrome.exe"')).toBe('C:\\Chrome\\chrome.exe')
  })

  it('is undefined when there is no value', () => {
    expect(regDefault('')).toBeUndefined()
    expect(regDefault('ERROR: The system was unable to find the specified registry key or value.')).toBeUndefined()
    expect(regDefault('    (Default)    REG_SZ    ')).toBeUndefined()
  })
})

/** A desktop where Chrome's new window comes to the front after `after` looks (never, when undefined). */
function desktop(after: number | undefined, other = false) {
  let looks = 0
  const typed: string[] = []
  const started: string[][] = []
  const deps: ChromeDeps = {
    front: () => {
      looks++
      if (after !== undefined && looks > after) return { hwnd: 200n, pid: 2 }
      return other && looks > 1 ? { hwnd: 300n, pid: 3 } : { hwnd: 100n, pid: 1 }
    },
    exeOf: pid => (pid === 2 ? 'chrome.exe' : pid === 3 ? 'notepad.exe' : 'altype.exe'),
    allowFront: () => {},
    typeAddress: async url => void typed.push(url),
    find: async () => 'C:\\Chrome\\chrome.exe',
    start: (_exe, args) => void started.push(args),
    sleep: async () => {},
    waitMs: 0,
  }
  return { deps, typed, started }
}

describe('isChromePage', () => {
  it('takes the extensions, their keys and one extension card', () => {
    expect(isChromePage('chrome://extensions/')).toBe(true)
    expect(isChromePage('chrome://extensions/shortcuts')).toBe(true)
    expect(isChromePage(`chrome://extensions/?id=${'abcdefghijklmnop'.repeat(2)}`)).toBe(true)
    expect(isChromePage('chrome://extensions/?id=xyz')).toBe(false)
    expect(isChromePage('chrome://settings/')).toBe(false)
    expect(isChromePage('https://example.com/')).toBe(false)
  })
})

describe('openInChrome', () => {
  it('opens no page but the extensions', async () => {
    const { deps, started } = desktop(1)
    expect(await openInChrome('https://example.com/', deps)).toBe('refused')
    expect(await openInChrome('chrome://settings/', deps)).toBe('refused')
    expect(started).toEqual([])
  })

  it('types the address into the new Chrome window', async () => {
    const d = desktop(1)
    d.deps.waitMs = 5000
    expect(await openInChrome('chrome://extensions/', d.deps)).toBe('typed')
    expect(d.started).toEqual([['--new-window']])
    expect(d.typed).toEqual(['chrome://extensions/'])
  })

  it('types nothing when Chrome does not come to the front', async () => {
    const d = desktop(undefined)
    expect(await openInChrome('chrome://extensions/', d.deps)).toBe('opened')
    expect(d.typed).toEqual([])
  })

  it('types nothing into another program in front', async () => {
    const d = desktop(undefined, true)
    expect(await openInChrome('chrome://extensions/', d.deps)).toBe('opened')
    expect(d.typed).toEqual([])
  })

  it('says so without Chrome', async () => {
    const d = desktop(1)
    d.deps.find = async () => undefined
    expect(await openInChrome('chrome://extensions/', d.deps)).toBe('missing')
    expect(d.started).toEqual([])
  })
})
