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

/** The card grew or shrank: it keeps its top unless the screen ends, then moves up. */
export function resize(bounds: Rect, height: number, area: Rect): Rect {
  const h = Math.min(height, area.height)
  const y = Math.min(bounds.y, area.y + area.height - h)
  return { ...bounds, y: Math.max(y, area.y), height: h }
}
