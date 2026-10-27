import { describe, expect, test } from 'vitest'

import { placeByTray, placeNear, resize } from './placement'

const area = { x: 0, y: 0, width: 1920, height: 1040 }
const size = { width: 440, height: 200 }

describe('placeNear', () => {
  test('below and to the right of the pointer', () => {
    expect(placeNear({ x: 100, y: 100 }, size, area)).toEqual({ x: 114, y: 114, width: 440, height: 200 })
  })

  test('turns to the left and above near the screen edges', () => {
    expect(placeNear({ x: 1800, y: 1000 }, size, area)).toEqual({ x: 1346, y: 786, width: 440, height: 200 })
  })

  test('stays on a second screen that starts left of the first', () => {
    const left = { x: -1280, y: 0, width: 1280, height: 1000 }
    expect(placeNear({ x: -10, y: 10 }, size, left)).toEqual({ x: -464, y: 24, width: 440, height: 200 })
  })
})

describe('placeByTray', () => {
  const panel = { width: 300, height: 360 }
  const icon = { x: 1700, y: 1048, width: 24, height: 24 }

  test('above the icon when the taskbar is at the bottom', () => {
    expect(placeByTray(icon, panel, area)).toEqual({ x: 1562, y: 672, width: 300, height: 360 })
  })

  test('kept inside the screen when the icon is near its corner', () => {
    expect(placeByTray({ ...icon, x: 1900 }, panel, area).x).toBe(1612)
  })

  test('below the icon when the taskbar is at the top', () => {
    const top = { x: 0, y: 40, width: 1920, height: 1040 }
    expect(placeByTray({ x: 1700, y: 8, width: 24, height: 24 }, panel, top).y).toBe(48)
  })

  test('beside the icon when the taskbar is on the right', () => {
    const narrow = { x: 0, y: 0, width: 1860, height: 1080 }
    expect(placeByTray({ x: 1880, y: 1000, width: 24, height: 24 }, panel, narrow)).toEqual({ x: 1552, y: 712, width: 300, height: 360 })
  })

  test('above an icon in the hidden icons flyout', () => {
    expect(placeByTray({ x: 1600, y: 960, width: 24, height: 24 }, panel, area).y).toBe(592)
  })
})

describe('resize', () => {
  test('keeps the top while it fits, moves up when it does not', () => {
    expect(resize({ x: 10, y: 100, width: 440, height: 200 }, 300, area).y).toBe(100)
    expect(resize({ x: 10, y: 900, width: 440, height: 200 }, 300, area)).toEqual({ x: 10, y: 740, width: 440, height: 300 })
  })
})
