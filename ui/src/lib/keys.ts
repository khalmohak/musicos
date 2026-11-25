import { useEffect, useRef } from 'react'
import { reveal } from './motion'

/** Remote-control vocabulary. Keyboards, IR/CEC remotes (via the kernel) and gamepads all map here. */
export type RemoteKey =
  | 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'
  | 'playpause' | 'next' | 'prev' | 'volup' | 'voldown' | 'menu'
  | 'settings' | 'search' | 'home' | 'stop' | 'power'

const MAP: Record<string, RemoteKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'ok', NumpadEnter: 'ok', ' ': 'playpause',
  Escape: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back',
  MediaPlayPause: 'playpause', MediaPlay: 'playpause', MediaPause: 'playpause', p: 'playpause',
  MediaTrackNext: 'next', n: 'next', MediaTrackPrevious: 'prev', b: 'prev',
  AudioVolumeUp: 'volup', '+': 'volup', '=': 'volup',
  AudioVolumeDown: 'voldown', '-': 'voldown',
  ContextMenu: 'menu', m: 'menu', Info: 'menu',
  // controller / remote buttons arrive as function keys from musicos-input (see inputd.py)
  F1: 'menu', F2: 'settings', F3: 'search', F4: 'home', BrowserHome: 'home', GoHome: 'home',
  BrowserSearch: 'search', MediaStop: 'stop', F5: 'power', Power: 'power',
}

export const toRemote = (e: KeyboardEvent): RemoteKey | undefined => MAP[e.key]

type Handler = { fn: (k: RemoteKey, e: KeyboardEvent) => boolean | void }
/** Handlers in the order they became active; the newest (a keyboard, a picker, a menu) gets
 * each key first and the screen behind it only sees keys it didn't handle. */
const stack: Handler[] = []
let installed = false

function dispatch(e: KeyboardEvent) {
  if (e.defaultPrevented) return
  const target = e.target as HTMLElement | null
  const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
  if (typing && e.key.length === 1) return // let text fields receive characters
  const k = toRemote(e)
  // unmapped keys (letters for on-screen keyboards) still go to handlers, as k=undefined
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].fn(k as RemoteKey, e)) {
      e.preventDefault()
      return
    }
  }
}

/**
 * Subscribe a screen or overlay to remote keys. Return true when the key is handled.
 * Becoming active (mount, or `enabled` turning true) puts it on top of the stack.
 */
export function useRemote(handler: (k: RemoteKey, e: KeyboardEvent) => boolean | void, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    if (!installed) {
      window.addEventListener('keydown', dispatch)
      installed = true
    }
    const h: Handler = { fn: (k, e) => (k === undefined && e.key.length !== 1 ? false : ref.current(k, e)) }
    stack.push(h)
    return () => {
      const i = stack.indexOf(h)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [enabled])
}

/**
 * Spatial navigation (tvOS-style): move focus to the nearest [data-nav] element in the
 * pressed direction, judged by on-screen position. Returns false at an edge.
 */
export function moveSpatial(root: HTMLElement | null, dir: 'up' | 'down' | 'left' | 'right') {
  if (!root) return false
  const items = [...root.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])')].filter((el) => el.offsetParent !== null)
  if (!items.length) return false
  const cur = document.activeElement as HTMLElement
  if (!items.includes(cur)) {
    focusEl(items[0])
    return true
  }
  const a = cur.getBoundingClientRect()
  const ax = a.left + a.width / 2
  const ay = a.top + a.height / 2
  let best: HTMLElement | null = null
  let bestScore = Infinity
  for (const el of items) {
    if (el === cur) continue
    const b = el.getBoundingClientRect()
    const bx = b.left + b.width / 2
    const by = b.top + b.height / 2
    const dx = bx - ax
    const dy = by - ay
    // must lie in the pressed direction (beyond our edge, with a little tolerance)
    const ok =
      dir === 'right' ? b.left >= a.right - 4 :
      dir === 'left' ? b.right <= a.left + 4 :
      dir === 'down' ? b.top >= a.bottom - 4 : b.bottom <= a.top + 4
    if (!ok) continue
    const along = dir === 'left' || dir === 'right' ? Math.abs(dx) : Math.abs(dy)
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx)
    // prefer things straight ahead: sideways distance counts a lot more
    const score = along + across * 2.5
    if (score < bestScore) {
      bestScore = score
      best = el
    }
  }
  if (!best) return false
  focusEl(best)
  return true
}

function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true })
  reveal(el, { block: 'nearest', inline: 'nearest' })
}

/** Move real DOM focus through the [data-nav] elements inside a container, in reading order. */
export function moveFocus(root: HTMLElement | null, dir: 1 | -1) {
  if (!root) return false
  const items = [...root.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])')]
  if (!items.length) return false
  const i = items.indexOf(document.activeElement as HTMLElement)
  const n = Math.max(0, Math.min(items.length - 1, i === -1 ? 0 : i + dir))
  if (n === i) return false
  const next = items[n]
  next.focus({ preventScroll: true })
  reveal(next, { block: 'nearest' })
  return true
}

export function focusFirst(root: HTMLElement | null) {
  const el = root?.querySelector<HTMLElement>('[data-autofocus], [data-nav]:not([disabled])')
  el?.focus({ preventScroll: true })
  reveal(el, { block: 'nearest' })
}
