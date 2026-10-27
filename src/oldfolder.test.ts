import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { expect, test } from 'vitest'

import { adoptOldFolders } from './oldfolder'

test('2Talker\'s folder moves over to Altype\'s, item by item, never over what is there; tu-talk fills the gaps', () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'altype-appdata-'))
  const put = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(appData, file)), { recursive: true })
    fs.writeFileSync(path.join(appData, file), text)
  }
  put('2Talker/settings.json', '{"native":"Russian"}')
  put('2Talker/words.json', '[1]')
  put('2Talker/models/ru/model.bin', 'm')
  put('tu-talk/voice/voice.onnx', 'v')
  put('tu-talk/settings.json', '{"old":true}')
  put('Altype/dict/de.json', 'kept')
  put('2Talker/dict/de.json', 'older')
  const userDir = path.join(appData, 'Altype')
  const moved = adoptOldFolders(appData, userDir)
  expect(moved.sort()).toEqual(['2Talker/models', '2Talker/settings.json', '2Talker/words.json', 'tu-talk/voice'])
  expect(fs.readFileSync(path.join(userDir, 'settings.json'), 'utf8')).toBe('{"native":"Russian"}')
  expect(fs.readFileSync(path.join(userDir, 'models/ru/model.bin'), 'utf8')).toBe('m')
  expect(fs.readFileSync(path.join(userDir, 'voice/voice.onnx'), 'utf8')).toBe('v')
  expect(fs.readFileSync(path.join(userDir, 'dict/de.json'), 'utf8')).toBe('kept')
  // A second start moves nothing.
  expect(adoptOldFolders(appData, userDir)).toEqual([])
})
