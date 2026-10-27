import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { build, context } from 'esbuild'

const watch = process.argv.includes('--watch')

if (!existsSync('vendor/bergamot/bergamot.wasm')) throw new Error('vendor/bergamot is missing: run npm run models')

// VS Code's icon font, used by the card.
mkdirSync('media', { recursive: true })
for (const file of ['codicon.css', 'codicon.ttf']) {
  copyFileSync(`node_modules/@vscode/codicons/dist/${file}`, `media/${file}`)
}

const node = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', sourcemap: true, logLevel: 'info' }

/** @type {import('esbuild').BuildOptions} */
const main = { ...node, entryPoints: ['src/main.ts'], external: ['electron', 'koffi', 'electron-updater'], outfile: 'dist/main.js' }

/** @type {import('esbuild').BuildOptions} */
const preload = { ...node, entryPoints: ['src/preload.ts'], external: ['electron'], outfile: 'dist/preload.js', sourcemap: false }

/**
 * onnxruntime-node loads its native binding from beside its own files; the
 * natural voice downloads the binding for this system instead, so the voice
 * process names it in TUTOR_ORT_BINDING.
 * @type {import('esbuild').Plugin}
 */
const downloadedBinding = {
  name: 'downloaded-binding',
  setup(b) {
    b.onLoad({ filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ }, async args => {
      const source = await readFile(args.path, 'utf8')
      const contents = source.replace(/require\(`\.\.\/bin\/[^`]+`\)/, "require('node:module').createRequire(__filename)(process.env.TUTOR_ORT_BINDING)")
      if (contents === source) throw new Error('onnxruntime-node: the binding require changed; update esbuild.mjs')
      return { contents, loader: 'js' }
    })
  },
}

/** @type {import('esbuild').BuildOptions} */
const voice = { ...node, entryPoints: ['src/voice-worker.ts'], outfile: 'dist/voice-worker.js', plugins: [downloadedBinding] }

/** @type {import('esbuild').BuildOptions} */
const translator = { ...node, entryPoints: ['src/mt-worker.ts'], outfile: 'dist/mt-worker.js' }

/** The keyboard helper's thread: Windows' keyboard hooks through koffi. */
/** @type {import('esbuild').BuildOptions} */
const keyboard = { ...node, entryPoints: ['src/kbd-worker.ts'], external: ['koffi'], outfile: 'dist/kbd-worker.js' }

/** @type {import('esbuild').BuildOptions} */
const card = {
  entryPoints: ['src/webview/card.ts'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  outfile: 'media/card.js',
  logLevel: 'info',
}

/** The app window: the notebook, the settings and how to use. */
const appWindow = { ...card, entryPoints: ['src/webview/app.ts'], outfile: 'media/app.js' }

/** The tray's panel, in place of Windows' menu. */
const trayPanel = { ...card, entryPoints: ['src/webview/tray.ts'], outfile: 'media/tray.js' }

const all = [main, preload, voice, translator, keyboard, card, appWindow, trayPanel]
if (watch) {
  const contexts = await Promise.all(all.map(o => context(o)))
  await Promise.all(contexts.map(c => c.watch()))
  console.log('watching…')
} else {
  await Promise.all(all.map(o => build(o)))
}
