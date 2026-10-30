// Windows tells a window about every change of the clipboard
// (WM_CLIPBOARDUPDATE) once it is registered as a listener; the main process
// hears it through the card window's message hook. Whether Ctrl is held is
// read from the keyboard state at that moment. user32 is called through koffi.

import type { BrowserWindow } from 'electron'
import koffi from 'koffi'

import { MAIN_KEYS } from './winkbd'

const WM_CLIPBOARDUPDATE = 0x031d
const VK_CONTROL = 0x11

const user32 = koffi.load('user32.dll')
const AddClipboardFormatListener = user32.func('bool __stdcall AddClipboardFormatListener(intptr_t hwnd)')
const RemoveClipboardFormatListener = user32.func('bool __stdcall RemoveClipboardFormatListener(intptr_t hwnd)')
const GetAsyncKeyState = user32.func('short __stdcall GetAsyncKeyState(int vKey)')

/** The window's HWND, as koffi takes an `intptr_t`. */
export function handleOf(window: BrowserWindow): bigint {
  const buffer = window.getNativeWindowHandle()
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0) : BigInt(buffer.readUInt32LE(0))
}

/** Calls `onChange` on every clipboard change until the returned function is called. */
export function watchClipboard(window: BrowserWindow, onChange: () => void): () => void {
  const hwnd = handleOf(window)
  window.hookWindowMessage(WM_CLIPBOARDUPDATE, () => onChange())
  if (!AddClipboardFormatListener(hwnd)) throw new Error('Windows did not let Krya watch the clipboard')
  return () => {
    RemoveClipboardFormatListener(hwnd)
    // On quitting, the window may be gone already.
    if (!window.isDestroyed()) window.unhookWindowMessage(WM_CLIPBOARDUPDATE)
  }
}

const WM_RENDERFORMAT = 0x0305
const WM_RENDERALLFORMATS = 0x0306

/** The window owns Krya's promised text (winclipboard.ts): `onRead` when a program asks for it, `onGoing` when the window goes first. */
export function watchRendering(window: BrowserWindow, onRead: () => void, onGoing: () => void): () => void {
  // Called within Windows' message: the text must be handed over before the hook returns.
  window.hookWindowMessage(WM_RENDERFORMAT, () => onRead())
  window.hookWindowMessage(WM_RENDERALLFORMATS, () => onGoing())
  return () => {
    if (window.isDestroyed()) return
    window.unhookWindowMessage(WM_RENDERFORMAT)
    window.unhookWindowMessage(WM_RENDERALLFORMATS)
  }
}

const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)')
const KEYEVENTF_KEYUP = 0x0002
const VK_SHIFT = 0x10
const VK_MENU = 0x12
const VK_LWIN = 0x5b
const VK_RWIN = 0x5c
const VK_C = 0x43
const VK_V = 0x56
const VK_L = 0x4c
const VK_RETURN = 0x0d
const MODIFIERS = [VK_CONTROL, VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN]

function held(vk: number): boolean {
  return (Number(GetAsyncKeyState(vk)) & 0x8000) !== 0
}

export function ctrlHeld(): boolean {
  return held(VK_CONTROL)
}

/** AutoHotkey's key that types nothing (typist.ts MASK_KEYS). */
const VK_MASK = 0xe8

/**
 * A shortcut with Alt or Win in it, just pressed: a key that types nothing,
 * pressed while they are still down, so letting them go opens no menu.
 * Without it, an Alt let go last (the shortcut's letter is Windows', the
 * program never sees it) is Alt tapped alone to Chrome: its menu takes the
 * focus, and the Ctrl+C that follows copies nothing from the page.
 */
export function maskMenu(): void {
  if (![VK_MENU, VK_LWIN, VK_RWIN].some(held)) return
  keybd_event(VK_MASK, 0, 0, MAIN_KEYS)
  keybd_event(VK_MASK, 0, KEYEVENTF_KEYUP, MAIN_KEYS)
}

/**
 * Presses Ctrl+C in the program in front, as the person would: once the
 * shortcut's own keys are let go (an Alt still down would make it Ctrl+Alt+C),
 * or after `maxWaitMs` regardless.
 */
export async function pressCopy(maxWaitMs = 1500): Promise<void> {
  await pressWithCtrl(VK_C, maxWaitMs)
}

/** Presses Ctrl+V in the program in front, the same way. */
export async function pressPaste(maxWaitMs = 1500): Promise<void> {
  await pressWithCtrl(VK_V, maxWaitMs)
}

/** Resolves once none of `keys` is held, or after `maxWaitMs` regardless. */
async function letGo(keys: readonly number[], maxWaitMs: number): Promise<void> {
  const until = Date.now() + maxWaitMs
  while (keys.some(held) && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 15))
  }
}

/**
 * Resolves once Enter and the modifiers are let go: a key still down when
 * another window comes to the front reaches that window (an Enter held there
 * sends a chat message).
 */
export function keysLetGo(maxWaitMs = 1500): Promise<void> {
  return letGo([VK_RETURN, ...MODIFIERS], maxWaitMs)
}

/** Ctrl+L in the program in front: a browser's address bar, its text selected. */
export async function pressAddressBar(maxWaitMs = 1500): Promise<void> {
  await pressWithCtrl(VK_L, maxWaitMs)
}

/** Enter in the program in front. */
export function pressEnter(): void {
  keybd_event(VK_RETURN, 0, 0, MAIN_KEYS)
  keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, MAIN_KEYS)
}

const VK_LEFT = 0x25
/** Shift+Left as many times as `chars`: the text just pasted, before the cursor, selected again. */
export async function pressSelectBack(chars: number, maxWaitMs = 1500): Promise<void> {
  await letGo(MODIFIERS, maxWaitMs)
  keybd_event(VK_SHIFT, 0, 0, MAIN_KEYS)
  for (let i = 0; i < chars; i++) {
    keybd_event(VK_LEFT, 0, 0, MAIN_KEYS)
    keybd_event(VK_LEFT, 0, KEYEVENTF_KEYUP, MAIN_KEYS)
  }
  keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, MAIN_KEYS)
}

const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()')

/** Resolves once `hwnd` is the window in front (Windows brings it there a moment after being asked), or after `maxWaitMs` regardless. */
export async function inFront(hwnd: bigint, maxWaitMs = 500): Promise<void> {
  const until = Date.now() + maxWaitMs
  while (BigInt(GetForegroundWindow() as number | bigint) !== hwnd && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 15))
  }
}

const AllowSetForegroundWindow = user32.func('bool __stdcall AllowSetForegroundWindow(uint32_t pid)')
const ASFW_ANY = 0xffffffff

/** Lets any program come to the front next (Windows lets the program in front allow it): a Chrome that runs already, say. */
export function allowForeground(): void {
  AllowSetForegroundWindow(ASFW_ANY)
}

async function pressWithCtrl(vk: number, maxWaitMs: number): Promise<void> {
  await letGo(MODIFIERS, maxWaitMs)
  keybd_event(VK_CONTROL, 0, 0, MAIN_KEYS)
  keybd_event(vk, 0, 0, MAIN_KEYS)
  keybd_event(vk, 0, KEYEVENTF_KEYUP, MAIN_KEYS)
  keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, MAIN_KEYS)
}
