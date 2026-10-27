// Where the card opens: just below and to the right of the pointer, turned to
// the other side of it where the screen ends, and never outside the screen's
// work area (the taskbar excluded).

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; width: number; height: number }

const OFFSET = 14

export function placeNear(point: Point, size: { width: number; height: number }, area: Rect): Rect {
  const width = Math.min(size.width, area.width)
  const height = Math.min(size.height, area.height)
  let x = point.x + OFFSET
  let y = point.y + OFFSET
  if (x + width > area.x + area.width) x = point.x - OFFSET - width
  if (y + height > area.y + area.height) y = point.y - OFFSET - height
  x = Math.min(Math.max(x, area.x), area.x + area.width - width)
  y = Math.min(Math.max(y, area.y), area.y + area.height - height)
  return { x: Math.round(x), y: Math.round(y), width, height }
}

const TRAY_GAP = 8

/**
 * The tray's panel: by the tray icon, on the side away from the taskbar
 * (above it when the taskbar is at the bottom), never outside the work area.
 * An icon inside the work area (in the hidden icons' flyout) gets the panel
 * above it, or below where there is no room.
 */
export function placeByTray(icon: Rect, size: { width: number; height: number }, area: Rect): Rect {
  const width = Math.min(size.width, area.width - 2 * TRAY_GAP)
  const height = Math.min(size.height, area.height - 2 * TRAY_GAP)
  const right = area.x + area.width
  const bottom = area.y + area.height
  let x = icon.x + icon.width / 2 - width / 2
  let y = icon.y + icon.height / 2 - height / 2
  if (icon.y >= bottom) y = bottom - TRAY_GAP - height
  else if (icon.y + icon.height <= area.y) y = area.y + TRAY_GAP
  else if (icon.x >= right) x = right - TRAY_GAP - width
  else if (icon.x + icon.width <= area.x) x = area.x + TRAY_GAP
  else y = icon.y - TRAY_GAP - height >= area.y ? icon.y - TRAY_GAP - height : icon.y + icon.height + TRAY_GAP
  x = Math.min(Math.max(x, area.x + TRAY_GAP), right - TRAY_GAP - width)
  y = Math.min(Math.max(y, area.y + TRAY_GAP), bottom - TRAY_GAP - height)
  return { x: Math.round(x), y: Math.round(y), width, height }
}

/** The card grew or shrank: it keeps its top unless the screen ends, then moves up. */
export function resize(bounds: Rect, height: number, area: Rect): Rect {
  const h = Math.min(height, area.height)
  const y = Math.min(bounds.y, area.y + area.height - h)
  return { ...bounds, y: Math.max(y, area.y), height: h }
}
