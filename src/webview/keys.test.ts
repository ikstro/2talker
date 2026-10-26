import { describe, expect, test } from 'vitest'

import { acceleratorOf, keyLabel, type KeyPress } from './keys'

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods })

describe('shortcuts', () => {
  test('a key press with modifiers becomes an accelerator', () => {
    expect(acceleratorOf(press('t', { ctrlKey: true, altKey: true }))).toBe('Control+Alt+T')
    expect(acceleratorOf(press('ArrowUp', { ctrlKey: true, shiftKey: true }))).toBe('Control+Shift+Up')
    expect(acceleratorOf(press('F8'))).toBe('F8')
  })

  test('a modifier alone, or a letter without one, is not a shortcut', () => {
    expect(acceleratorOf(press('Control', { ctrlKey: true }))).toBeUndefined()
    expect(acceleratorOf(press('q'))).toBeUndefined()
  })

  test('shown the Windows way', () => {
    expect(keyLabel('Control+Alt+S')).toBe('Ctrl+Alt+S')
  })
})
