import { useEffect, useRef } from 'react'

/** Remote-control vocabulary. Keyboards, IR/CEC remotes (via the kernel) and gamepads all map here. */
export type RemoteKey =
  | 'up' | 'down' | 'left' | 'right' | 'ok' | 'back'
  | 'playpause' | 'next' | 'prev' | 'volup' | 'voldown' | 'menu'

const MAP: Record<string, RemoteKey> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'ok', NumpadEnter: 'ok', ' ': 'playpause',
  Escape: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back',
  MediaPlayPause: 'playpause', MediaPlay: 'playpause', MediaPause: 'playpause', p: 'playpause',
  MediaTrackNext: 'next', n: 'next', MediaTrackPrevious: 'prev', b: 'prev',
  AudioVolumeUp: 'volup', '+': 'volup', '=': 'volup',
  AudioVolumeDown: 'voldown', '-': 'voldown',
  ContextMenu: 'menu', m: 'menu', Info: 'menu',
}

export const toRemote = (e: KeyboardEvent): RemoteKey | undefined => MAP[e.key]

/**
 * Subscribe the current screen to remote keys. Return true from the handler to mark the
 * key as handled (prevents default scrolling / typing).
 */
export function useRemote(handler: (k: RemoteKey, e: KeyboardEvent) => boolean | void, enabled = true) {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      // nested components subscribe first (child effects run before parent effects), so a
      // handled key never reaches the screen behind, e.g. Back closing a keyboard, not setup
      if (e.defaultPrevented) return
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')
      if (typing && e.key.length === 1) return // let text fields receive characters
      const k = toRemote(e)
      if (!k) return
      if (ref.current(k, e)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** Move real DOM focus through the [data-nav] elements inside a container, in reading order. */
export function moveFocus(root: HTMLElement | null, dir: 1 | -1) {
  if (!root) return false
  const items = [...root.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])')]
  if (!items.length) return false
  const i = items.indexOf(document.activeElement as HTMLElement)
  const next = items[Math.max(0, Math.min(items.length - 1, i === -1 ? 0 : i + dir))]
  next.focus({ preventScroll: false })
  return true
}

export function focusFirst(root: HTMLElement | null) {
  root?.querySelector<HTMLElement>('[data-autofocus], [data-nav]:not([disabled])')?.focus()
}
