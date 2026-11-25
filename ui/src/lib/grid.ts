import type { RemoteKey } from './keys'
import { sfx } from './sounds'

/**
 * Arrow-key movement in a grid of `count` items laid out `cols` wide.
 * Returns the new index, or 'out-up' / 'out-down' / 'out-left' when leaving the grid.
 */
export function gridMove(
  k: RemoteKey, idx: number, count: number, cols: number,
): number | 'out-up' | 'out-down' | 'out-left' | null {
  if (k === 'left') {
    if (idx % cols === 0) return 'out-left'
    return idx - 1
  }
  if (k === 'right') return idx % cols === cols - 1 || idx === count - 1 ? idx : idx + 1
  if (k === 'up') return idx < cols ? 'out-up' : idx - cols
  if (k === 'down') {
    if (Math.floor(idx / cols) === Math.floor((count - 1) / cols)) return 'out-down'
    return Math.min(count - 1, idx + cols)
  }
  return null
}

/** Apply a gridMove result with the matching interface sound; returns the index to use. */
export function stepTo(idx: number, next: number) {
  if (next === idx) sfx.edge()
  else sfx.tick()
  return next
}
