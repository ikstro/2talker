import { describe, expect, test } from 'vitest'

import { DEFAULTS, normalize } from './settings'

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

  test('a shortcut may be cleared; a missing one is the default', () => {
    expect(normalize({ snipKey: ' ', selectKey: ' Control+Alt+T ' })).toMatchObject({ snipKey: '', selectKey: 'Control+Alt+T' })
    expect(normalize({}).snipKey).toBe('Control+Alt+S')
  })

  test('the card size stays within reach; a height of 0 is automatic', () => {
    expect(normalize({ cardWidth: 90, cardHeight: 9000 })).toMatchObject({ cardWidth: 320, cardHeight: 2400 })
    expect(normalize({ cardWidth: 612.4, cardHeight: 0 })).toMatchObject({ cardWidth: 612, cardHeight: 0 })
    expect(normalize({ cardWidth: 'wide' }).cardWidth).toBe(440)
  })

  test('English is the learned language, never the native one', () => {
    expect(normalize({ native: 'English' }).native).toBe('Russian')
  })
})
