import { describe, expect, it } from 'vitest'
import { openInChrome, regDefault } from './chrome'

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

describe('openInChrome', () => {
  it('opens no page but the extensions', async () => {
    expect(await openInChrome('https://example.com/')).toBe(false)
    expect(await openInChrome('chrome://settings/')).toBe(false)
  })
})
