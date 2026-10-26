// Windows tells a window about every change of the clipboard
// (WM_CLIPBOARDUPDATE) once it is registered as a listener; the main process
// hears it through the card window's message hook. Whether Ctrl is held is
// read from the keyboard state at that moment. user32 is called through koffi.

import type { BrowserWindow } from 'electron'
import koffi from 'koffi'

const WM_CLIPBOARDUPDATE = 0x031d
const VK_CONTROL = 0x11

const user32 = koffi.load('user32.dll')
const AddClipboardFormatListener = user32.func('bool __stdcall AddClipboardFormatListener(intptr_t hwnd)')
const RemoveClipboardFormatListener = user32.func('bool __stdcall RemoveClipboardFormatListener(intptr_t hwnd)')
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)')

function handleOf(window: BrowserWindow): bigint {
  const buffer = window.getNativeWindowHandle()
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0))
}

/** Calls `onChange` on every clipboard change until the returned function is called. */
export function watchClipboard(window: BrowserWindow, onChange: () => void): () => void {
  const hwnd = handleOf(window)
  window.hookWindowMessage(WM_CLIPBOARDUPDATE, () => onChange())
  if (!AddClipboardFormatListener(hwnd)) throw new Error('Windows did not let 2Talker watch the clipboard')
  return () => {
    RemoveClipboardFormatListener(hwnd)
    window.unhookWindowMessage(WM_CLIPBOARDUPDATE)
  }
}

export function ctrlHeld(): boolean {
  return (Number(GetAsyncKeyState(VK_CONTROL)) & 0x8000) !== 0
}
