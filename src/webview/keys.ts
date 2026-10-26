// Shortcuts as Electron writes them ("Control+Alt+S"), recorded from a key
// press in the settings, and shown the way Windows writes them ("Ctrl+Alt+S").

/** The parts of a key event a shortcut is made of. */
export type KeyPress = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>

/** The accelerator Electron understands for a key event: "Control+Alt+S". */
export function acceleratorOf(event: KeyPress): string | undefined {
  const mods = [event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super'].filter(Boolean)
  const key = event.key
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key)) return undefined
  let name: string
  if (/^[a-z]$/i.test(key)) name = key.toUpperCase()
  else if (/^[0-9]$/.test(key)) name = key
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) name = key
  else if (key === ' ') name = 'Space'
  else if (['Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'].includes(key)) name = key
  else if (/^Arrow(Up|Down|Left|Right)$/.test(key)) name = key.slice(5)
  else if (/^`~!@#$%^&*()\-_=+\[\]{};:'",.<>\/?\\|$/.test(key) || key.length === 1) name = key
  else return undefined
  // A letter or digit alone would swallow typing everywhere; a modifier is required.
  if (mods.length === 0 && !/^F\d+$/.test(name)) return undefined
  return [...mods, name].join('+')
}

export function keyLabel(accelerator: string): string {
  return accelerator.replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')
}
