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

const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)')
const KEYEVENTF_KEYUP = 0x0002
const VK_SHIFT = 0x10
const VK_MENU = 0x12
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const VK_C = 0x43

function held(vk: number): boolean {
  return (Number(GetAsyncKeyState(vk)) & 0x8000) !== 0
}

export function ctrlHeld(): boolean {
  return held(VK_CONTROL)
}

/**
 * Presses Ctrl+C in the program in front, as the person would: once the
 * shortcut's own keys are let go (an Alt still down would make it Ctrl+Alt+C),
 * or after `maxWaitMs` regardless.
 */
export async function pressCopy(maxWaitMs = 1500): Promise<void> {
  const until = Date.now() + maxWaitMs
  while ([VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN].some(held) && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  keybd_event(VK_CONTROL, 0, 0, 0)
  keybd_event(VK_C, 0, 0, 0)
  keybd_event(VK_C, 0, KEYEVENTF_KEYUP, 0)
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, 0)
}
