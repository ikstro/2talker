// Altype's own log: a line per thing worth knowing after the fact (a window
// that did not show, a download that failed), in %APPDATA%\Altype\altype.log,
// beside the engine's speech.log. The console gets the same line; main.ts
// sends its warnings here too. Kept small: past 1 MB the file starts over.

import * as fs from 'node:fs'
import * as path from 'node:path'

const MOST = 1_000_000

let file = ''

/** Where the log goes; until this is called, lines go to the console only. */
export function logTo(dir: string): void {
  file = path.join(dir, 'altype.log')
}

export function log(line: string): void {
  const stamp = new Date().toISOString().slice(11, 23)
  console.log(`Altype ${stamp} ${line}`)
  if (!file) return
  try {
    if (fs.existsSync(file) && fs.statSync(file).size > MOST) fs.truncateSync(file)
    fs.appendFileSync(file, `${new Date().toISOString()} ${line}\n`)
  } catch {
    // The log is a help, never a fault.
  }
}
