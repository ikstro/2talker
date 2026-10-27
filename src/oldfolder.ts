// The app was called 2Talker, and tu-talk before that: its folder in
// %APPDATA% moves over to Altype's once, item by item, from the newest old
// folder that has each item. Nothing already in the new folder is replaced.

import * as fs from 'node:fs'
import * as path from 'node:path'

/** The app's earlier folder names, newest first. */
export const OLD_FOLDERS = ['2Talker', 'tu-talk']
/** What moves: the settings, the word notebook, the translator, the voice, the dictionaries. */
export const ITEMS = ['settings.json', 'words.json', 'models', 'voice', 'dict']

/** Moves the old folders' items into `userDir`; returns what moved. A failed move is left behind and reported. */
export function adoptOldFolders(appData: string, userDir: string, warn: (message: string, error: unknown) => void = () => undefined): string[] {
  const moved: string[] = []
  for (const oldName of OLD_FOLDERS) {
    const old = path.join(appData, oldName)
    if (path.resolve(old) === path.resolve(userDir) || !fs.existsSync(old)) continue
    for (const name of ITEMS) {
      const from = path.join(old, name)
      const to = path.join(userDir, name)
      if (!fs.existsSync(from) || fs.existsSync(to)) continue
      try {
        fs.mkdirSync(userDir, { recursive: true })
        fs.renameSync(from, to)
        moved.push(`${oldName}/${name}`)
      } catch (error) {
        warn(`Altype: could not move ${from}`, error)
      }
    }
  }
  return moved
}
