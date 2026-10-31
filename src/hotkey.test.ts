import { describe, expect, test } from 'vitest'

import { HotkeyRecorder, hotkeyLabel, isAccelerator, isExtendedKey, parseHotkey } from './hotkey'

/** Events in order: "+Code" down, "-Code" up, "@ms" time passes, "mouse4" a side button; what they record. */
function record(...events: string[]): string[] {
  const recorder = new HotkeyRecorder()
  let now = 0
  const out: string[] = []
  for (const e of events) {
    if (e.startsWith('@')) {
      now += Number(e.slice(1))
      continue
    }
    now += 50
    const r = e.startsWith('mouse') ? recorder.mouse(Number(e.slice(5))) : e.startsWith('+') ? recorder.keydown(e.slice(1), now) : recorder.keyup(e.slice(1), now)
    if (r) out.push(r.more ? `${r.hotkey}?` : r.hotkey)
  }
  return out
}

describe('recording keys', () => {
  test('keys with modifiers, as Electron writes them', () => {
    expect(record('+ControlLeft', '+AltLeft', '+KeyT')).toEqual(['Control+Alt+T'])
    expect(record('+ControlLeft', '+ShiftLeft', '+ArrowUp')).toEqual(['Control+Shift+Up'])
    expect(record('+ControlLeft', '+Slash')).toEqual(['Control+/'])
    expect(record('+F8')).toEqual(['F8'])
  })

  test('a modifier tapped once (it may yet become a double), twice, or with another', () => {
    expect(record('+ControlLeft', '-ControlLeft')).toEqual(['LeftControl?'])
    expect(record('+ControlLeft', '-ControlLeft', '+ControlLeft', '-ControlLeft')).toEqual(['LeftControl?', 'LeftControl*2'])
    expect(record('+ControlLeft', '-ControlLeft', '@600', '+ControlLeft', '-ControlLeft')).toEqual(['LeftControl?', 'LeftControl?'])
    expect(record('+ControlLeft', '+ShiftLeft', '-ShiftLeft', '-ControlLeft')).toEqual(['Control+Shift'])
  })

  test('a key alone, a side button of the mouse', () => {
    expect(record('+Pause')).toEqual(['Pause'])
    expect(record('+CapsLock')).toEqual(['CapsLock'])
    expect(record('mouse4')).toEqual(['MouseForward'])
    expect(record('+ControlLeft', 'mouse3')).toEqual(['Control+MouseBack'])
  })

  test('a typing key needs a modifier', () => {
    expect(record('+KeyQ', '-KeyQ')).toEqual([])
    expect(record('+Space')).toEqual([])
  })
})

describe('reading keys back', () => {
  test('for matching', () => {
    expect(parseHotkey('LeftControl')).toEqual({ kind: 'tap', vk: 0xa2 })
    expect(parseHotkey('LeftControl*2')).toEqual({ kind: 'double', vk: 0xa2 })
    expect(parseHotkey('Shift+Control')).toEqual({ kind: 'chord', mods: ['Control', 'Shift'] })
    expect(parseHotkey('Pause')).toEqual({ kind: 'key', mods: [], vk: 0x13 })
    expect(parseHotkey('Control+MouseBack')).toEqual({ kind: 'mouse', mods: ['Control'], button: 1 })
    expect(parseHotkey('Q')).toBeUndefined()
    expect(parseHotkey('')).toBeUndefined()
  })

  test('Electron holds a key with a modifier, or an F key; the keyboard thread the rest', () => {
    expect(isAccelerator('Control+Alt+T')).toBe(true)
    expect(isAccelerator('F8')).toBe(true)
    expect(isAccelerator('LeftControl*2')).toBe(false)
    expect(isAccelerator('Pause')).toBe(false)
    expect(isAccelerator('Control+Pause')).toBe(false)
    expect(isAccelerator('MouseForward')).toBe(false)
  })

  test('shown the Windows way', () => {
    expect(hotkeyLabel('Control+Alt+S')).toBe('Ctrl+Alt+S')
    expect(hotkeyLabel('LeftControl')).toBe('Left Ctrl')
    expect(hotkeyLabel('LeftControl*2')).toBe('Left Ctrl twice')
    expect(hotkeyLabel('Control+Shift')).toBe('Ctrl+Shift')
    expect(hotkeyLabel('CapsLock')).toBe('Caps Lock')
    expect(hotkeyLabel('Control+MouseBack')).toBe('Ctrl+Mouse Back')
  })
})

describe('keys Krya presses', () => {
  test('Right Alt, Right Ctrl, the Win keys and the arrows are extended: let go without saying so, Right Alt would stay down', () => {
    for (const vk of [0xa5, 0xa3, 0x5b, 0x5c, 0x25, 0x26, 0x27, 0x28, 0x2e, 0x24]) expect(isExtendedKey(vk), vk.toString(16)).toBe(true)
  })

  test('Left Alt, Left Ctrl, the letters and the signs are not', () => {
    for (const vk of [0xa4, 0xa2, 0xa0, 0xa1, 0x43, 0x56, 0x08, 0x0d, 0xe8, 0xbf]) expect(isExtendedKey(vk), vk.toString(16)).toBe(false)
  })
})
