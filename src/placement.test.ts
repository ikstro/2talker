import { describe, expect, test } from 'vitest'

import { placeNear, resize } from './placement'

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

describe('resize', () => {
  test('keeps the top while it fits, moves up when it does not', () => {
    expect(resize({ x: 10, y: 100, width: 440, height: 200 }, 300, area).y).toBe(100)
    expect(resize({ x: 10, y: 900, width: 440, height: 200 }, 300, area)).toEqual({ x: 10, y: 740, width: 440, height: 300 })
  })
})
