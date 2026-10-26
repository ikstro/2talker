// Reads the text of a snipped piece of the screen with the OCR engine built
// into Windows (Windows.Media.Ocr), through Windows PowerShell like the
// system voice in speech.ts. The engine is chosen from the languages whose
// text recognition is installed: the person's own first (its engine reads
// Latin letters too), then English.

import { spawn } from 'node:child_process'

import type { OcrLine } from './ocrtext'

const SCRIPT = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, [Type]$type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(); $t.Result }
$available = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages)
$engine = $null; $tag = ''
foreach ($want in $env:TUTOR_OCR_LANGS.Split(',')) {
  $match = $available | Where-Object { $_.LanguageTag -eq $want -or $_.LanguageTag.Split('-')[0] -eq $want } | Select-Object -First 1
  if ($match) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($match); $tag = $match.LanguageTag; break }
}
if (-not $engine) { @{ lang = ''; lines = @() } | ConvertTo-Json -Compress; exit }
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($env:TUTOR_OCR_IMAGE)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$stream.Dispose()
$lines = @(foreach ($line in $result.Lines) {
  $boxes = @($line.Words | ForEach-Object { $_.BoundingRect })
  $left = ($boxes | ForEach-Object { $_.X } | Measure-Object -Minimum).Minimum
  $top = ($boxes | ForEach-Object { $_.Y } | Measure-Object -Minimum).Minimum
  $right = ($boxes | ForEach-Object { $_.X + $_.Width } | Measure-Object -Maximum).Maximum
  $bottom = ($boxes | ForEach-Object { $_.Y + $_.Height } | Measure-Object -Maximum).Maximum
  @{ text = $line.Text; x = $left; y = $top; w = $right - $left; h = $bottom - $top }
})
@{ lang = $tag; lines = $lines } | ConvertTo-Json -Depth 4 -Compress
`

export type OcrResult = {
  /** The language tag of the engine that read the image; empty when Windows has text recognition for none of the languages asked. */
  lang: string
  lines: OcrLine[]
}

/** Reads the PNG at `image` with the first engine installed among `languages` (codes such as "ru", "en"). */
export function recognize(image: string, languages: readonly string[]): Promise<OcrResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, TUTOR_OCR_IMAGE: image, TUTOR_OCR_LANGS: languages.join(',') },
    })
    let out = ''
    let err = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => (out += chunk))
    child.stderr.on('data', (chunk: string) => (err = (err + chunk).slice(-2000)))
    const timer = setTimeout(() => child.kill(), 30_000)
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', code => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(out.trim()) as { lang?: unknown; lines?: unknown }
        const lines = (Array.isArray(parsed.lines) ? parsed.lines : []) as OcrLine[]
        resolve({ lang: typeof parsed.lang === 'string' ? parsed.lang : '', lines: lines.filter(l => typeof l?.text === 'string') })
      } catch {
        reject(new Error(err.trim().split('\n').pop() || `text recognition stopped (${code})`))
      }
    })
  })
}
