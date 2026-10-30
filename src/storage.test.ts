import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, expect, test } from 'vitest'

import { folderSize, isUnder, markAway, measureParts } from './storage'

const made: string[] = []
afterEach(() => made.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })))

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krya-storage-'))
  made.push(dir)
  return dir
}

test('a folder\'s size is its files\', deep down; a file is its own size; nothing there is nothing', async () => {
  const root = tempDir()
  fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true })
  fs.writeFileSync(path.join(root, 'one.bin'), Buffer.alloc(100))
  fs.writeFileSync(path.join(root, 'a', 'two.bin'), Buffer.alloc(20))
  fs.writeFileSync(path.join(root, 'a', 'b', 'three.bin'), Buffer.alloc(3))
  expect(await folderSize(root)).toEqual({ bytes: 123, shared: 0 })
  expect(await folderSize(path.join(root, 'one.bin'))).toEqual({ bytes: 100, shared: 0 })
  expect(await folderSize(path.join(root, 'missing'))).toEqual({ bytes: 0, shared: 0 })
})

test('a file hard-linked from elsewhere (uv\'s cache) counts as shared', async () => {
  const root = tempDir()
  fs.mkdirSync(path.join(root, 'cache'))
  fs.mkdirSync(path.join(root, 'env'))
  fs.writeFileSync(path.join(root, 'cache', 'torch.dll'), Buffer.alloc(50))
  fs.linkSync(path.join(root, 'cache', 'torch.dll'), path.join(root, 'env', 'torch.dll'))
  fs.writeFileSync(path.join(root, 'env', 'own.dll'), Buffer.alloc(7))
  expect(await folderSize(path.join(root, 'env'))).toEqual({ bytes: 57, shared: 50 })
})

test('a download used from outside Krya\'s folder is marked away; the person\'s own things and what is not there are not', () => {
  const home = 'C:\\Users\\you\\AppData\\Local\\Krya'
  const parts = markAway(
    [
      { id: 'speech', path: 'C:\\Users\\you\\AppData\\Local\\Altype\\speech', bytes: 7e9, shared: 0 },
      { id: 'voice', path: 'c:\\users\\you\\appdata\\local\\krya\\voice', bytes: 2e8, shared: 0 },
      { id: 'dict', path: 'C:\\Users\\you\\AppData\\Local\\Krya2\\dict', bytes: 3e6, shared: 0 },
      { id: 'most', path: 'C:\\Users\\you\\AppData\\Local\\Altype\\translate\\models\\m.gguf', bytes: 0, shared: 0 },
      { id: 'yours', path: 'C:\\Users\\you\\AppData\\Roaming\\Krya', bytes: 1e6, shared: 0 },
    ],
    home,
    ['speech', 'voice', 'dict', 'most'],
  )
  expect(parts.filter(p => p.away).map(p => p.id)).toEqual(['speech', 'dict'])
  expect(isUnder(home, home)).toBe(true)
})

test('parts are measured in the order given', async () => {
  const root = tempDir()
  fs.writeFileSync(path.join(root, 'model.gguf'), Buffer.alloc(10))
  fs.mkdirSync(path.join(root, 'engine'))
  fs.writeFileSync(path.join(root, 'engine', 'llama.exe'), Buffer.alloc(5))
  const parts = await measureParts([
    { id: 'accurate', path: path.join(root, 'model.gguf') },
    { id: 'llama', path: path.join(root, 'engine') },
    { id: 'voice', path: path.join(root, 'none') },
  ])
  expect(parts.map(p => [p.id, p.bytes])).toEqual([
    ['accurate', 10],
    ['llama', 5],
    ['voice', 0],
  ])
})
