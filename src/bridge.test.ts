import { describe, expect, test } from 'vitest'

import { callAllowed, messageAllowed, openable, pageOf } from './bridge'

const at = (page: string) => `file:///C:/Users/you/AppData/Local/Programs/krya/resources/app.asar/media/${page}?frame=dwm`

describe('which page sent a message', () => {
  test('each of Krya\'s pages by its file; anything else is another', () => {
    expect([pageOf(at('app.html')), pageOf(at('card.html')), pageOf(at('tray.html')), pageOf(at('dictation.html'))]).toEqual(['app', 'card', 'tray', 'dictation'])
    expect(pageOf(at('badge.html'))).toBe('other')
    expect(pageOf('https://evil.example/app.html')).toBe('other')
    expect(pageOf('')).toBe('other')
  })
})

describe('a page that shows text from outside opens, removes and exports nothing', () => {
  const dangerous = ['openPath', 'showInFolder', 'openLink', 'installSpeech', 'removeSpeech', 'removeModel', 'removeDownload', 'moveToKrya', 'importBackup', 'exportBackup', 'resetSettings', 'restartSpeech']
  test.each(['card', 'tray', 'dictation'] as const)('the %s', page => {
    for (const type of dangerous) expect(messageAllowed(page, type), type).toBe(false)
  })
  test('the app window may', () => {
    for (const type of dangerous) expect(messageAllowed('app', type), type).toBe(true)
  })
  test('each page keeps what it does', () => {
    for (const type of ['ready', 'speak', 'speakNatural', 'stop', 'close', 'pin', 'maximize', 'height', 'copyText', 'pasteText', 'translateText', 'checkText', 'lookup', 'saveWord', 'unsaveWord', 'saveSettings', 'downloadNatural', 'openSpeechSettings']) expect(messageAllowed('card', type), type).toBe(true)
    for (const type of ['trayReady', 'trayHeight', 'trayClose', 'tray', 'keepWord', 'saveSettings']) expect(messageAllowed('tray', type), type).toBe(true)
    for (const type of ['dictationReady', 'dictationText', 'dictationAudio', 'dictationNote', 'dictationHeight', 'dictationCancelled', 'dictationFailed']) expect(messageAllowed('dictation', type), type).toBe(true)
  })
  test('an unknown page sends nothing', () => {
    expect(messageAllowed('other', 'ready')).toBe(false)
  })
})

describe('calls with an answer', () => {
  const speech = (method: string, route: string) => ({ call: 'speech', method, route }) as const
  test('the dictation badge dictates and records a note, and nothing else', () => {
    expect(callAllowed('dictation', speech('PUT', '/dictate/sessions/a1/3'))).toBe(true)
    expect(callAllowed('dictation', speech('POST', '/dictate?language=auto&expected=ru,en&strict=1&format=pcm16'))).toBe(true)
    expect(callAllowed('dictation', speech('POST', '/recordings'))).toBe(true)
    expect(callAllowed('dictation', speech('PUT', '/settings'))).toBe(false)
    expect(callAllowed('dictation', speech('GET', '/transcripts'))).toBe(false)
    expect(callAllowed('dictation', speech('GET', '/dictate/../transcripts'))).toBe(false)
    expect(callAllowed('dictation', speech('GET', '/dictateX'))).toBe(false)
    expect(callAllowed('dictation', { call: 'exportTranscript', id: 'x', format: 'txt', name: 'x' })).toBe(false)
  })
  test('the card and the tray panel call nothing; the app window everything', () => {
    for (const page of ['card', 'tray', 'other'] as const) expect(callAllowed(page, speech('GET', '/health'))).toBe(false)
    expect(callAllowed('app', speech('PUT', '/settings'))).toBe(true)
    expect(callAllowed('app', { call: 'pickFolder', title: 't', current: '' })).toBe(true)
  })
})

describe('what a page may open with the system', () => {
  const folders = new Set(['C:\\Users\\you\\Documents\\Krya\\Transcripts', '\\\\nas\\kb'])
  const isDirectory = (p: string) => folders.has(p)
  test('a folder, a note, a text file', () => {
    expect(openable('C:\\Users\\you\\Documents\\Krya\\Transcripts', isDirectory)).toBe(true)
    expect(openable('E:\\kb\\Inbox\\2026-10-30 Standup.md', isDirectory)).toBe(true)
    expect(openable('C:\\Users\\you\\AppData\\Roaming\\Krya\\krya.txt', isDirectory)).toBe(true)
    expect(openable('\\\\nas\\kb', isDirectory)).toBe(true)
  })
  test('never a program, a script, a shortcut, an address or a relative path', () => {
    for (const p of ['C:\\Windows\\System32\\calc.exe', '\\\\evil\\share\\p.exe', 'C:\\x\\run.bat', 'C:\\x\\a.cmd', 'C:\\x\\a.lnk', 'C:\\x\\a.url', 'C:\\x\\a.ps1', 'C:\\x\\a.js', 'C:\\x\\a.hta', 'https://evil.example', 'ms-settings:speech', 'file:///C:/x.exe', 'notes.md', 'C:notes.md', '\\\\?\\C:\\x.exe', '', undefined, 5]) {
      expect(openable(p, isDirectory), String(p)).toBe(false)
    }
  })
  test('a path that is not there is no folder', () => {
    expect(
      openable('C:\\gone', () => {
        throw new Error('ENOENT')
      }),
    ).toBe(false)
  })
})
