import { describe, expect, test } from 'vitest'

import { addKept, DEFAULTS, keptForm, myLanguages, normalize } from './settings'

describe('Kept as typed', () => {
  test('a word is kept trimmed and in lower case', () => {
    expect(keptForm('  Ghbdtn ')).toBe('ghbdtn')
    expect(addKept(['vbh'], ' GHBDTN')).toEqual(['vbh', 'ghbdtn'])
  })

  test('an empty word or one kept already adds nothing', () => {
    expect(addKept(['ghbdtn'], '   ')).toBeUndefined()
    expect(addKept(['ghbdtn'], 'Ghbdtn')).toBeUndefined()
  })
})

describe('normalize', () => {
  test('a missing or broken file gives the defaults, with the native language from the system', () => {
    expect(normalize(undefined)).toEqual(DEFAULTS)
    expect(normalize('nonsense', 'German')).toEqual({ ...DEFAULTS, native: 'German' })
  })

  test('keeps valid values, replaces the rest', () => {
    const s = normalize({ native: 'Українська', voice: 'natural:bf_emma', rate: 3, autoRead: false, wordHint: 'hover', theme: 'blue', oneAtATime: 'yes' })
    expect(s).toEqual({ ...DEFAULTS, native: 'Ukrainian', voice: 'natural:bf_emma', autoRead: false, wordHint: 'hover' })
    expect(normalize({ rate: 1.5, theme: 'dark', oneAtATime: true })).toMatchObject({ rate: 1.5, theme: 'dark', oneAtATime: true })
  })

  test('the translation level is Fast until another one is picked', () => {
    expect(normalize({}).translationLevel).toBe('fast')
    expect(normalize({ translationLevel: 'most' }).translationLevel).toBe('most')
    expect(normalize({ translationLevel: 'best' }).translationLevel).toBe('fast')
  })

  test('one model translates and checks: the level follows it, and an older file takes it from its level', () => {
    expect(normalize({})).toMatchObject({ translationLevel: 'fast', model: 'accurate' })
    expect(normalize({ translationLevel: 'most' })).toMatchObject({ translationLevel: 'most', model: 'most' })
    // Picked on the Check page: a level that was the other model moves with it; Fast stays Fast.
    expect(normalize({ translationLevel: 'accurate', model: 'most' })).toMatchObject({ translationLevel: 'most', model: 'most' })
    expect(normalize({ translationLevel: 'fast', model: 'most' })).toMatchObject({ translationLevel: 'fast', model: 'most' })
    expect(normalize({ model: 'gemma' }).model).toBe('accurate')
  })

  test('a shortcut may be cleared; a missing one is the default', () => {
    expect(normalize({ snipKey: ' ', selectKey: ' Control+Alt+T ' })).toMatchObject({ snipKey: '', selectKey: 'Control+Alt+T' })
    expect(normalize({}).snipKey).toBe('Control+Alt+S')
  })

  test('the card size stays within reach; a height of 0 is automatic', () => {
    expect(normalize({ cardWidth: 90, cardHeight: 9000 })).toMatchObject({ cardWidth: 320, cardHeight: 2400 })
    expect(normalize({ cardWidth: 612.4, cardHeight: 0 })).toMatchObject({ cardWidth: 612, cardHeight: 0 })
    expect(normalize({ cardWidth: 'wide' }).cardWidth).toBe(440)
  })

  test('the keyboard helper is off at first; its lists keep only what they may hold', () => {
    expect(normalize({})).toMatchObject({ switchKey: '', fixKey: '', autoFix: false, layoutBadge: false, layouts: [], translateKey: '', textKey: 'Control+Alt+T' })
    expect(normalize({ layouts: ['04090409', 'f0a80422', 'nonsense', 5, '04090409'], keepWords: ['jwt', 'jwt'], layoutKeys: { '04190419': ' RightControl ', bad: 'X', '04090409': '' } })).toMatchObject({
      layouts: ['04090409', 'F0A80422'],
      keepWords: ['jwt'],
      layoutKeys: { '04190419': 'RightControl' },
    })
    expect(normalize({ translateKey: ' LeftShift*2 ' }).translateKey).toBe('LeftShift*2')
    // Check my English: its key and the practice key, none by default.
    expect(normalize({})).toMatchObject({ checkKey: '', practiceKey: '' })
    expect(normalize({ checkKey: ' RightControl*2 ', practiceKey: 'Control+Alt+P' })).toMatchObject({ checkKey: 'RightControl*2', practiceKey: 'Control+Alt+P' })
  })

  test('programs: the old list of programs left out of fixing becomes rules; a rule keeps known parts and a layout id only', () => {
    expect(normalize({ fixApps: [' Code.EXE ', ''] }).apps).toEqual([{ exe: 'code.exe', off: ['fix'], layout: '' }])
    expect(normalize({ fixApps: ['old.exe'], apps: [] }).apps).toEqual([])
    expect(normalize({ apps: [{ exe: 'Term.exe', off: ['fix', 'nonsense', 'badge'], layout: '04090409' }, { exe: 'term.exe' }, { off: ['fix'] }] }).apps).toEqual([
      { exe: 'term.exe', off: ['fix', 'badge'], layout: '04090409' },
    ])
  })

  test('new keyboard parts start as decided: capitals set right, learning on, quiet on the full screen, the rest off', () => {
    expect(normalize({})).toMatchObject({ fixTwoCaps: true, fixCapsLock: true, learn: true, quietFullScreen: true, keepCaps: false, fixOnPause: false, fixSound: false, trayLayout: false, switchOn: true, fixKeyOn: true, betaUpdates: false })
  })

  test('English is the learned language, never the native one', () => {
    expect(normalize({ native: 'English' }).native).toBe('Russian')
  })

  test('the languages used: valid codes beyond the person’s own and English, each once', () => {
    const s = normalize({ native: 'Russian', languages: ['UK', 'en', 'ru', 'xx', 'de', 'uk', 7] })
    expect(s.languages).toEqual(['uk', 'de'])
    expect(myLanguages(s)).toEqual(['ru', 'en', 'uk', 'de'])
    expect(myLanguages(normalize({}))).toEqual(['ru', 'en'])
  })
})
