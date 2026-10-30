import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MISTAKES_MOST, MistakeStore } from './mistakes'

describe('MistakeStore', () => {
  const dirs: string[] = []
  afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })))
  const file = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mistakes-'))
    dirs.push(dir)
    return path.join(dir, 'mistakes.json')
  }

  it('keeps a text with a mistake, newest first, and the same text once', () => {
    const f = file()
    let now = 1_000_000
    const store = new MistakeStore(f, () => now)
    expect(store.add({ text: 'I has a cat.', corrected: 'I has a cat.', note: '' })).toBe(false)
    expect(store.add({ text: ' He go home. ', corrected: 'He goes home.', note: 'go → goes' })).toBe(true)
    now += 1000
    store.add({ text: 'I has a cat.', corrected: 'I have a cat.', note: 'has → have' })
    now += 1000
    store.add({ text: 'He go home.', corrected: 'He goes home.', note: 'go → goes: he' })
    expect(store.list().map(e => [e.text, e.note])).toEqual([
      ['He go home.', 'go → goes: he'],
      ['I has a cat.', 'has → have'],
    ])
    // Read back as saved.
    expect(new MistakeStore(f).list()).toEqual(store.list())
  })

  it('forgets one, or all, and keeps at most its cap', () => {
    const f = file()
    let now = 0
    const store = new MistakeStore(f, () => (now += 1000))
    for (let i = 0; i < MISTAKES_MOST + 3; i++) store.add({ text: `He go ${i}.`, corrected: `He goes ${i}.`, note: '' })
    expect(store.list()).toHaveLength(MISTAKES_MOST)
    const first = store.list()[0]!
    store.remove(first.at)
    expect(store.list().some(e => e.at === first.at)).toBe(false)
    store.clear()
    expect(new MistakeStore(f).list()).toEqual([])
  })
})
