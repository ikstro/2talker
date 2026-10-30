// What Krya keeps on this computer, measured for the Storage page: every
// download in one folder (%LOCALAPPDATA%\Krya) and the person's own things
// (%APPDATA%\Krya, the transcripts). On a computer with uv of its own (a
// developer's), the speech engine's packages are hard links into uv's cache:
// the same bytes in two folders, counted as `shared` so the page can say what
// a removal really frees. That cache is not Krya's and is not shown.

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { StorageId, StoragePart } from './protocol'

export type Measured = { bytes: number; shared: number }

/** The bytes under `target` (a folder or a file), and how many of them are in files linked from elsewhere too; nothing when it is not there. Links to folders are not followed. */
export async function folderSize(target: string): Promise<Measured> {
  let stat: fs.Stats
  try {
    stat = await fs.promises.lstat(target)
  } catch {
    return { bytes: 0, shared: 0 }
  }
  if (stat.isFile()) return { bytes: stat.size, shared: stat.nlink > 1 ? stat.size : 0 }
  if (!stat.isDirectory()) return { bytes: 0, shared: 0 }
  let names: string[]
  try {
    names = await fs.promises.readdir(target)
  } catch {
    return { bytes: 0, shared: 0 }
  }
  const inside = await Promise.all(names.map(name => folderSize(path.join(target, name))))
  return inside.reduce((sum, m) => ({ bytes: sum.bytes + m.bytes, shared: sum.shared + m.shared }), { bytes: 0, shared: 0 })
}

/** A part: its place, and `only` these files in it when it is not all of it (the models no longer used, beside those in use). */
export type Place = { id: StorageId; path: string; only?: readonly string[] }

/** Whether `target` is `dir` or inside it, whatever the case Windows wrote either in. */
export function isUnder(target: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir).toLowerCase(), path.resolve(target).toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** The downloads Krya uses from outside its folder `home` (a move that could not finish), marked `away`. */
export function markAway(parts: readonly StoragePart[], home: string, downloads: readonly StorageId[]): StoragePart[] {
  return parts.map(p => (downloads.includes(p.id) && p.bytes > 0 && !isUnder(p.path, home) ? { ...p, away: true } : p))
}

/** Each part measured, in the order given. */
export async function measureParts(parts: readonly Place[]): Promise<StoragePart[]> {
  const sizeOf = async (p: Place): Promise<Measured> => {
    if (!p.only) return folderSize(p.path)
    const each = await Promise.all(p.only.map(folderSize))
    return each.reduce((sum, m) => ({ bytes: sum.bytes + m.bytes, shared: sum.shared + m.shared }), { bytes: 0, shared: 0 })
  }
  return Promise.all(parts.map(async p => ({ id: p.id, path: p.path, ...(await sizeOf(p)) })))
}
